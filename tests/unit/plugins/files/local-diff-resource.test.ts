import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  markDocumentError,
  markDocumentLoaded,
  markDocumentReadResult,
  markDocumentSaved,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { FileChangesResource } from "@plugins/builtin/files/renderer/git-changes/resource.ts";
import type {
  CompareRequest,
  FileChanges,
} from "@plugins/builtin/files/renderer/git-changes/types.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const releases: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  clearFilesDocumentStore();
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.resolve();
  clearFilesDocumentStore();
  vi.useRealTimers();
});
function setup(path = "a.md") {
  const document = ensureDiskDocument({ root: "/repo", path });
  markDocumentLoaded(document.id, "saved\n");
  const baseline = {
    status: "ready" as const,
    gitRoot: "/repo",
    path,
    basePath: path,
    headOid: "a".repeat(40),
    contents: "head\n",
    existsAtHead: true,
  };
  const stopWatch = vi.fn();
  const context = {
    git: {
      getFileBaseline: vi.fn(async () => baseline),
      watch: vi.fn(() => stopWatch),
    },
  } as unknown as RendererPluginContext;
  const worker = {
    compare: vi.fn(async (input: CompareRequest) => compareFileContents(input)),
    cancel: vi.fn(),
  };
  const resource = new FileChangesResource(context, document.id, worker);
  return { document, context, baseline, worker, resource, stopWatch };
}
async function settle() {
  await vi.advanceTimersByTimeAsync(151);
}

describe("shared current document changes", () => {
  it("compares unsaved text, and save/index notifications preserve the same content version", async () => {
    const { resource, context, document, worker } = setup();
    releases.push(resource.subscribe(() => undefined));
    await settle();
    expect(resource.getSnapshot().ranges[0]?.excerpt.additionLines).toEqual([
      "saved\n",
    ]);
    updateDocumentContents(document.id, "unsaved\n");
    const version = resource.getSnapshot().version;
    expect(resource.getSnapshot().status).toBe("updating");
    await settle();
    expect(resource.getSnapshot().ranges[0]?.excerpt.additionLines).toEqual([
      "unsaved\n",
    ]);
    expect(resource.getSnapshot().dirty).toBe(true);
    markDocumentSaved(document.id, "unsaved\n");
    await resource.refresh();
    await settle();
    expect(resource.getSnapshot().version).toBe(version);
    expect(resource.getSnapshot().dirty).toBe(false);
    expect(worker.compare).toHaveBeenCalledTimes(2);
    expect(context.git.getFileBaseline).toHaveBeenCalledTimes(2);
  });
  it("does not accept an old Worker result after another edit", async () => {
    const { resource, worker, document } = setup();
    let first: ((value: FileChanges) => void) | undefined;
    worker.compare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = (value) => resolve(value);
        })
    );
    releases.push(resource.subscribe(() => undefined));
    await settle();
    updateDocumentContents(document.id, "latest\n");
    await settle();
    first?.(
      compareFileContents({
        before: "head\n",
        after: "old\n",
        path: "a.md",
        version: 1,
      })
    );
    await Promise.resolve();
    expect(resource.getSnapshot().ranges[0]?.excerpt.additionLines).toEqual([
      "latest\n",
    ]);
  });
  it("defers composition and releases the one root watch after the final consumer", async () => {
    const { resource, context, worker, stopWatch, document } = setup();
    const release1 = resource.subscribe(() => undefined);
    const release2 = resource.subscribe(() => undefined);
    await settle();
    resource.setComposing(true);
    updateDocumentContents(document.id, "composing\n");
    await settle();
    expect(worker.compare).toHaveBeenCalledTimes(1);
    resource.setComposing(false);
    await settle();
    expect(worker.compare).toHaveBeenCalledTimes(2);
    expect(context.git.watch).toHaveBeenCalledTimes(1);
    release1();
    await Promise.resolve();
    expect(stopWatch).not.toHaveBeenCalled();
    release2();
    await Promise.resolve();
    expect(stopWatch).toHaveBeenCalledTimes(1);
  });
  it("surfaces baseline errors without treating the file as added", async () => {
    const { resource, context, worker } = setup();
    vi.mocked(context.git.getFileBaseline).mockRejectedValue(
      new Error("permission denied")
    );
    releases.push(resource.subscribe(() => undefined));
    await settle();
    expect(resource.getSnapshot()).toMatchObject({
      status: "error",
      message: "permission denied",
      ranges: [],
    });
    expect(worker.compare).not.toHaveBeenCalled();
  });
  it.each([
    true,
    false,
  ])("compares readable text even when writable=%s", async (writable) => {
    const { resource, document } = setup();
    markDocumentReadResult(document.id, {
      kind: "text",
      root: "/repo",
      path: "a.md",
      canonicalPath: "/repo/a.md",
      contents: "read only\n",
      eol: "lf",
      format: { bom: false, encoding: "utf8" },
      mtimeMs: 1,
      mode: 0o444,
      revision: "read-only",
      size: 10,
      writable,
    });
    releases.push(resource.subscribe(() => undefined));
    await settle();
    expect(resource.getSnapshot().status).toBe("ready");
    expect(resource.getSnapshot().ranges).toHaveLength(1);
  });
  it("preserves retry after a baseline failure followed by typing", async () => {
    const { resource, context, document } = setup();
    vi.mocked(context.git.getFileBaseline).mockRejectedValue(
      new Error("offline")
    );
    releases.push(resource.subscribe(() => undefined));
    await settle();
    updateDocumentContents(document.id, "typed after failure");
    await settle();
    expect(resource.getSnapshot().status).toBe("error");
  });
  it("invalidates a pending baseline when the document becomes unreadable", async () => {
    const { resource, context, document, baseline, stopWatch } = setup();
    let resolveBaseline: ((value: typeof baseline) => void) | undefined;
    vi.mocked(context.git.getFileBaseline).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBaseline = resolve;
        })
    );
    releases.push(resource.subscribe(() => undefined));
    markDocumentError(document.id, "cannot read file");
    resolveBaseline?.(baseline);
    await settle();
    expect(resource.getSnapshot().status).not.toBe("ready");
    expect(resource.getSnapshot().ranges).toEqual([]);
    expect(stopWatch).toHaveBeenCalledTimes(1);
  });
  it("keeps large files on demand and uses a bounded worker budget", async () => {
    const { resource, document, worker } = setup();
    updateDocumentContents(document.id, "x\n".repeat(50_001));
    releases.push(resource.subscribe(() => undefined));
    await settle();
    expect(resource.getSnapshot().status).toBe("on-demand");
    expect(worker.compare).not.toHaveBeenCalled();
    await resource.calculate();
    expect(worker.compare).toHaveBeenCalledWith(expect.anything(), 5000);
    expect(resource.getSnapshot().status).toBe("ready");
  });
  it("invalidates unobserved changes after watch failure and restarts the watch on retry", async () => {
    const { resource, context, worker } = setup();
    releases.push(resource.subscribe(() => undefined));
    await settle();
    const onFailure = vi.mocked(context.git.watch).mock.calls[0]?.[2];
    onFailure?.(new Error("watch unavailable"));
    await settle();
    expect(resource.getSnapshot()).toMatchObject({
      status: "error",
      ranges: [],
    });
    await resource.calculate();
    await settle();
    expect(context.git.watch).toHaveBeenCalledTimes(2);
    expect(worker.compare).toHaveBeenCalledTimes(2);
    expect(resource.getSnapshot().status).toBe("ready");
  });
});
