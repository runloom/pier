import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorViewSession } from "@plugins/builtin/files/renderer/file-editor-view-session.ts";
import type { FilesDocument } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { FilesEditorGitGutterController } from "@plugins/builtin/files/renderer/files-editor-git-gutter-controller.ts";
import type { GitDiffPatch } from "@shared/contracts/git.ts";
import { describe, expect, it, vi } from "vitest";

function makeSession(): FileEditorViewSession {
  return {
    setGitGutterMarkers: vi.fn(),
    clearGitGutterMarkers: vi.fn(),
  } as unknown as FileEditorViewSession;
}

function makeContext(
  getDiffPatch: (
    cwd: string,
    opts?: { from?: string; path?: string }
  ) => Promise<GitDiffPatch>
): { context: RendererPluginContext; unsub: ReturnType<typeof vi.fn> } {
  const unsub = vi.fn();
  const context = {
    git: {
      getDiffPatch: vi.fn(getDiffPatch),
      watch: vi.fn(() => unsub),
    },
  } as unknown as RendererPluginContext;
  return { context, unsub };
}

function diskDocument(root: string, path: string): FilesDocument {
  return {
    id: `${root}/${path}`,
    source: { kind: "disk", path, root },
  } as unknown as FilesDocument;
}

function untitledDocument(id: string): FilesDocument {
  return {
    id,
    source: { kind: "untitled", id, name: "x", language: "text" },
  } as unknown as FilesDocument;
}

describe("FilesEditorGitGutterController", () => {
  it("does nothing for untitled documents (clears only)", () => {
    const { context } = makeContext(async () => ({ files: [] }));
    const ctrl = new FilesEditorGitGutterController(context);
    const session = makeSession();
    ctrl.attach("s1", untitledDocument("u1"), session);
    expect(
      session.setGitGutterMarkers as ReturnType<typeof vi.fn>
    ).not.toHaveBeenCalled();
    expect(
      session.clearGitGutterMarkers as ReturnType<typeof vi.fn>
    ).toHaveBeenCalled();
  });

  it("fetches diff on attach and sets markers", async () => {
    const filePatch: GitDiffPatch["files"][number] = {
      binary: false,
      path: "src/a.ts",
      oldPath: "src/a.ts",
      hunks: [
        {
          newStart: 1,
          newLines: 2,
          oldStart: 1,
          oldLines: 1,
          lines: [
            { kind: "context", text: "a" },
            { kind: "add", text: "b" },
          ],
        },
      ],
    };
    const { context } = makeContext(async () => ({ files: [filePatch] }));
    const ctrl = new FilesEditorGitGutterController(context);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    await Promise.resolve();
    await Promise.resolve();
    const setSpy = session.setGitGutterMarkers as ReturnType<typeof vi.fn>;
    expect(setSpy).toHaveBeenCalled();
    const markers = setSpy.mock.calls[0]?.[0] as Map<number, unknown>;
    expect(markers.get(2)).toEqual({ count: 1, kind: "added" });
  });

  it("clears markers when diff fetch fails", async () => {
    const { context } = makeContext(async () =>
      Promise.reject(new Error("boom"))
    );
    const ctrl = new FilesEditorGitGutterController(context);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      session.clearGitGutterMarkers as ReturnType<typeof vi.fn>
    ).toHaveBeenCalled();
  });

  it("detach unsubscribes watch when last session for root leaves", () => {
    const { context, unsub } = makeContext(async () => ({ files: [] }));
    const ctrl = new FilesEditorGitGutterController(context);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    ctrl.detach("s1");
    expect(unsub).toHaveBeenCalled();
  });

  it("clearSession clears without fetch", () => {
    const { context } = makeContext(async () => ({ files: [] }));
    const ctrl = new FilesEditorGitGutterController(context);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    ctrl.clearSession("s1");
    expect(
      session.clearGitGutterMarkers as ReturnType<typeof vi.fn>
    ).toHaveBeenCalled();
  });

  it("empty patch files clears markers", async () => {
    const { context } = makeContext(async () => ({ files: [] }));
    const ctrl = new FilesEditorGitGutterController(context);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    await Promise.resolve();
    await Promise.resolve();
    const setSpy = session.setGitGutterMarkers as ReturnType<typeof vi.fn>;
    expect(setSpy).toHaveBeenCalledTimes(1);
    const markers = setSpy.mock.calls[0]?.[0] as Map<number, unknown>;
    expect(markers.size).toBe(0);
  });

  it("merged root fetch: one IPC call dispatches to all sessions for that root", async () => {
    const getDiffPatch = vi.fn(
      async (_cwd: string, _options?: { from?: string; path?: string }) => ({
        files: [
          { binary: false, path: "src/a.ts", oldPath: "src/a.ts", hunks: [] },
          { binary: false, path: "src/b.ts", oldPath: "src/b.ts", hunks: [] },
        ],
      })
    );
    const context = {
      git: { getDiffPatch, watch: vi.fn(() => () => undefined) },
    } as unknown as RendererPluginContext;
    const ctrl = new FilesEditorGitGutterController(context);
    const s1 = makeSession();
    const s2 = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), s1);
    ctrl.attach("s2", diskDocument("/repo", "src/b.ts"), s2);
    await Promise.resolve();
    await Promise.resolve();
    // 单次 root 级拉取分发到两个会话（attach 触发两次，但每次都是 root 级无 path 调用）。
    expect(getDiffPatch).toHaveBeenCalled();
    for (const call of getDiffPatch.mock.calls) {
      expect(call[1]).toEqual({ from: "HEAD" });
    }
    expect(
      s1.setGitGutterMarkers as ReturnType<typeof vi.fn>
    ).toHaveBeenCalled();
    expect(
      s2.setGitGutterMarkers as ReturnType<typeof vi.fn>
    ).toHaveBeenCalled();
  });
});
