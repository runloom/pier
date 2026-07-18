import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileQueryService } from "../../../src/main/services/file-query/file-query-service.ts";
import * as pathWalk from "../../../src/main/services/file-query/path-walk.ts";
import type { FileQueryEvent } from "../../../src/shared/contracts/file-query.ts";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});
async function makeFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-file-query-"));
  roots.push(root);
  await mkdir(join(root, "src", "main", "ipc"), { recursive: true });
  await writeFile(join(root, "src", "main", "ipc", "theme.ts"), "");
  await mkdir(join(root, "src", "plugins", "builtin", "files", "renderer"), {
    recursive: true,
  });
  await writeFile(
    join(
      root,
      "src",
      "plugins",
      "builtin",
      "files",
      "renderer",
      "code-mirror-editor-theme.ts"
    ),
    ""
  );
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "pkg", "x.ts"), "");
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, ".git", "HEAD"), "");
  return root;
}

interface Recorder {
  readonly done: Promise<void>;
  emit(event: FileQueryEvent): void;
  readonly events: FileQueryEvent[];
}

function recorder(): Recorder {
  const events: FileQueryEvent[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  return {
    events,
    done: promise,
    emit(event) {
      events.push(event);
      if (event.kind === "done" || event.kind === "error") resolve();
    },
  };
}

describe("createFileQueryService", () => {
  it("emits started, batch containing basename match, then done", async () => {
    const root = await makeFixtureRoot();
    const service = createFileQueryService({});
    const rec = recorder();

    service.start(
      1,
      {
        queryId: "q1",
        owner: "quick-open:s1",
        root,
        query: "theme.ts",
        limit: 200,
        mruPaths: [],
      },
      rec.emit
    );

    await rec.done;

    expect(rec.events[0]).toEqual({ kind: "started", queryId: "q1" });
    const batch = rec.events.find((event) => event.kind === "batch");
    if (batch?.kind !== "batch") throw new Error("expected batch");
    const paths = batch.items.map((item) => item.path);
    expect(paths).toContain(
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
    );
    expect(paths).toContain("src/main/ipc/theme.ts");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
    const done = rec.events.at(-1);
    if (done?.kind !== "done") throw new Error("expected done");
    expect(done.reason).toBe("completed");
    expect(done.scanned).toBeGreaterThan(0);
  });

  it("second start under same owner cancels first, first never batches after done", async () => {
    const root = await makeFixtureRoot();
    const service = createFileQueryService({});
    const first = recorder();
    const second = recorder();

    service.start(
      1,
      {
        queryId: "q1",
        owner: "quick-open:s1",
        root,
        query: "theme.ts",
        limit: 200,
        mruPaths: [],
      },
      first.emit
    );
    service.start(
      1,
      {
        queryId: "q2",
        owner: "quick-open:s1",
        root,
        query: "code-mirror",
        limit: 200,
        mruPaths: [],
      },
      second.emit
    );

    await Promise.all([first.done, second.done]);

    const firstDone = first.events.findLast((event) => event.kind === "done");
    if (firstDone?.kind !== "done") throw new Error("expected done");
    expect(firstDone.reason).toBe("cancelled");
    const doneIndex = first.events.indexOf(firstDone);
    for (let i = doneIndex + 1; i < first.events.length; i += 1) {
      expect(first.events[i]?.kind).not.toBe("batch");
    }

    const secondDone = second.events.at(-1);
    if (secondDone?.kind !== "done") throw new Error("expected done");
    expect(secondDone.reason).toBe("completed");
  });

  it("cancel is idempotent and safe with no active session", () => {
    const service = createFileQueryService({});
    expect(() => service.cancel(1, "missing")).not.toThrow();
    expect(() => service.cancelAll(1)).not.toThrow();
    expect(() => service.cancel(1, "missing")).not.toThrow();
  });

  it("cancel by queryId aborts an in-flight walk", async () => {
    const root = await makeFixtureRoot();
    const service = createFileQueryService({});
    const rec = recorder();

    service.start(
      1,
      {
        queryId: "q1",
        owner: "quick-open:s1",
        root,
        query: "theme.ts",
        limit: 200,
        mruPaths: [],
      },
      rec.emit
    );
    service.cancel(1, "q1");
    service.cancel(1, "q1");

    await rec.done;
    const done = rec.events.findLast((event) => event.kind === "done");
    if (done?.kind !== "done") throw new Error("expected done");
    expect(done.reason).toBe("cancelled");
  });

  it("skips paths matched by default excludes (dot-git)", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-file-query-"));
    roots.push(root);
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "objects", "pack"), "");
    await writeFile(join(root, "keep.ts"), "");
    const service = createFileQueryService({});
    const rec = recorder();
    service.start(
      1,
      {
        queryId: "q1",
        owner: "tree-search:t1",
        root,
        query: "",
        limit: 200,
        mruPaths: [],
      },
      rec.emit
    );
    await rec.done;
    const batch = rec.events.find((event) => event.kind === "batch");
    if (batch?.kind !== "batch") throw new Error("expected batch");
    const paths = batch.items.map((item) => item.path);
    expect(paths).toContain("keep.ts");
    for (const p of paths) {
      expect(p.startsWith(".git/")).toBe(false);
    }
  });

  it("uses provided excludePatterns as the full source without re-merging defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-file-query-"));
    roots.push(root);
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "objects", "pack"), "");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "bundle.js"), "");
    await writeFile(join(root, "keep.ts"), "");

    const service = createFileQueryService({});
    const rec = recorder();
    service.start(
      1,
      {
        limit: 200,
        mruPaths: [],
        options: {
          applyExcludePatterns: true,
          // User removed **/.git from their tree setting — provided value is
          // the full exclude source, not merged with built-in defaults.
          excludePatterns: "**/dist",
        },
        owner: "quick-open:s1",
        query: "",
        queryId: "q-exclude",
        root,
      },
      rec.emit
    );
    await rec.done;

    const batch = rec.events.find((event) => event.kind === "batch");
    if (batch?.kind !== "batch") throw new Error("expected batch");
    const paths = batch.items.map((item) => item.path);
    expect(paths).toContain("keep.ts");
    expect(paths).toContain(".git/objects/pack");
    expect(paths.some((path) => path.startsWith("dist/"))).toBe(false);
  });

  it("falls back to defaults when excludePatterns is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-file-query-"));
    roots.push(root);
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "objects", "pack"), "");
    await writeFile(join(root, "keep.ts"), "");

    const service = createFileQueryService({});
    const rec = recorder();
    service.start(
      1,
      {
        limit: 200,
        mruPaths: [],
        options: { applyExcludePatterns: true },
        owner: "quick-open:s1",
        query: "",
        queryId: "q-defaults",
        root,
      },
      rec.emit
    );
    await rec.done;

    const batch = rec.events.find((event) => event.kind === "batch");
    if (batch?.kind !== "batch") throw new Error("expected batch");
    const paths = batch.items.map((item) => item.path);
    expect(paths).toContain("keep.ts");
    expect(paths.some((path) => path.startsWith(".git/"))).toBe(false);
  });
  it("emits only error (no trailing done) when walkFiles throws", async () => {
    const root = await makeFixtureRoot();
    vi.spyOn(pathWalk, "walkFiles").mockRejectedValueOnce(
      new Error("simulated walk crash")
    );
    const service = createFileQueryService({});
    const rec = recorder();
    service.start(
      1,
      {
        limit: 200,
        mruPaths: [],
        owner: "quick-open:s1",
        query: "theme",
        queryId: "q-walk-crash",
        root,
      },
      rec.emit
    );
    await rec.done;
    expect(rec.events.some((e) => e.kind === "error")).toBe(true);
    expect(rec.events.some((e) => e.kind === "done")).toBe(false);
    const err = rec.events.find((e) => e.kind === "error");
    if (err?.kind !== "error") throw new Error("expected error");
    expect(err.code).toBe("walk-failed");
    expect(err.message).toContain("simulated walk crash");
  });
});
