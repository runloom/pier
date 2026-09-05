import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  markDocumentLoaded,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import { FilesEditorGitGutterController } from "@plugins/builtin/files/renderer/editor/git-gutter-controller.ts";
import type { FileEditorViewSession } from "@plugins/builtin/files/renderer/editor/view-session.ts";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { registerFileChangeRequests } from "@plugins/builtin/files/renderer/git-changes/requests.ts";
import type { CompareRequest } from "@plugins/builtin/files/renderer/git-changes/types.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@plugins/builtin/files/renderer/git-changes/worker-client.ts", () => ({
  FileChangesWorker: class {
    compare(input: CompareRequest) {
      return Promise.resolve(compareFileContents(input));
    }
    cancel() {}
  },
}));
const controllers: FilesEditorGitGutterController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  await Promise.resolve();
  clearFilesDocumentStore();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  const document = ensureDiskDocument({ root: "/repo", path: "a.ts" });
  markDocumentLoaded(document.id, "head\ncurrent\n");
  const baseline = {
    status: "ready" as const,
    gitRoot: "/repo",
    path: "a.ts",
    basePath: "a.ts",
    headOid: "a".repeat(40),
    contents: "head\n",
    existsAtHead: true,
  };
  const stop = vi.fn();
  const context = {
    git: {
      getFileBaseline: vi.fn(async () => baseline),
      watch: vi.fn(() => stop),
    },
  } as unknown as RendererPluginContext;
  const controller = new FilesEditorGitGutterController(context);
  controllers.push(controller);
  const session = {
    setGitGutterModel: vi.fn(),
    setGitGutterNavigate: vi.fn(),
    clearGitGutterMarkers: vi.fn(),
    getEditorView: () => null,
  } as unknown as FileEditorViewSession;
  return { controller, session, document, context, stop, baseline };
}
describe("Files current-document gutter controller", () => {
  it("shares the document baseline between source sessions and follows unsaved edits", async () => {
    const { controller, session, document, context, stop } = setup();
    controller.attach("s1", document, session);
    controller.attach("s2", document, session);
    await vi.advanceTimersByTimeAsync(151);
    expect(context.git.getFileBaseline).toHaveBeenCalledTimes(1);
    expect(context.git.watch).toHaveBeenCalledTimes(1);
    expect(session.setGitGutterModel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [expect.objectContaining({ newLineFrom: 2, kind: "added" })],
      })
    );
    updateDocumentContents(document.id, "draft\n");
    await vi.advanceTimersByTimeAsync(151);
    expect(session.setGitGutterModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ contents: "draft\n" })
    );
    controller.detach("s1");
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    controller.detach("s2");
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("routes a gutter click to its own panel's local peek", async () => {
    const { controller, session, document } = setup();
    const request = vi.fn();
    const unregister = registerFileChangeRequests("s1", request);
    controller.attach("s1", document, session);
    await vi.advanceTimersByTimeAsync(151);
    vi.mocked(session.setGitGutterNavigate).mock.calls.at(-1)?.[0]?.(2);
    expect(request).toHaveBeenCalledWith({ kind: "line", line: 2 });
    unregister();
  });
  it("clears old HEAD markers immediately while a new baseline is being compared", async () => {
    const { controller, session, document, baseline, context } = setup();
    controller.attach("s1", document, session);
    await vi.advanceTimersByTimeAsync(151);
    const calls = vi.mocked(session.clearGitGutterMarkers).mock.calls.length;
    vi.mocked(context.git.getFileBaseline).mockResolvedValue({
      ...baseline,
      headOid: "b".repeat(40),
      contents: "different\n",
    });
    controller.refreshByRoot("/repo");
    await vi.advanceTimersByTimeAsync(1);
    expect(
      vi.mocked(session.clearGitGutterMarkers).mock.calls.length
    ).toBeGreaterThan(calls);
  });
});
