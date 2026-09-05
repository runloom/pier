import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { openSavedFileChanges } from "@plugins/builtin/files/renderer/git-changes/navigation.ts";
import type { FileChangesSnapshot } from "@plugins/builtin/files/renderer/git-changes/types.ts";
import { describe, expect, it, vi } from "vitest";

function fixture(dirty = false) {
  const snapshot: FileChangesSnapshot = {
    ...compareFileContents({
      path: "a.md",
      before: "old\n",
      after: "new\n",
      version: 1,
    }),
    status: "ready",
    version: 1,
    contents: "new\n",
    baseline: "old\n",
    headOid: "a".repeat(40),
    dirty,
  };
  const slot = {
    sectionKey: "section",
    group: "unstaged",
    targetPath: "a.md",
    oldPath: null,
    status: "modified",
  };
  const getReviewIndex = vi.fn(async () => ({
    kind: "ok",
    entries: [{ path: "a.md", oldPaths: [], renderSlots: [slot] }],
  }));
  const getReviewFileDocument = vi.fn(async () => ({
    kind: "ok",
    sections: [
      {
        kind: "patch",
        sectionKey: "section",
        oldContents: "old\n",
        newContents: "new\n",
        changeBlocks: [
          {
            workingRange: { start: 7, count: 1 },
            headRange: { start: 7, count: 1 },
          },
        ],
      },
    ],
  }));
  const openUncommittedChanges = vi.fn(() => true);
  const context = {
    git: { getReviewIndex, getReviewFileDocument, openUncommittedChanges },
  } as unknown as RendererPluginContext;
  return {
    snapshot,
    context,
    getReviewIndex,
    getReviewFileDocument,
    openUncommittedChanges,
    panelContext: {
      contextId: "file-context",
      projectRootPath: "/project",
      gitRoot: "/wrong",
      updatedAt: 1,
    },
    root: "/worktree",
    path: "a.md",
    range: snapshot.ranges[0],
  };
}
describe("full review navigation from local peek", () => {
  it("uses precise coordinates only for a saved section with identical contents", async () => {
    const input = fixture();
    expect(await openSavedFileChanges(input)).toBe("opened");
    expect(input.openUncommittedChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        panelContext: expect.objectContaining({
          contextId: "file-context",
          gitRoot: "/worktree",
          worktreeRoot: "/worktree",
        }),
        pendingReveal: expect.objectContaining({
          path: "a.md",
          line: 1,
          group: "unstaged",
          side: "new",
        }),
      })
    );
  });
  it("dirty buffers use the saved file's first change, never their buffer line", async () => {
    const input = fixture(true);
    await openSavedFileChanges(input);
    expect(input.openUncommittedChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingReveal: expect.objectContaining({ line: 7 }),
      })
    );
  });
  it("does not open an empty disk review for a draft-only change", async () => {
    const input = fixture(true);
    input.getReviewIndex.mockResolvedValue({ kind: "ok", entries: [] });
    expect(await openSavedFileChanges(input)).toBe("save-first");
    expect(input.openUncommittedChanges).not.toHaveBeenCalled();
  });
  it("does not reuse a stale location when the disk changed independently", async () => {
    const input = fixture();
    input.getReviewFileDocument.mockResolvedValue({
      kind: "ok",
      sections: [
        {
          kind: "patch",
          sectionKey: "section",
          oldContents: "old\n",
          newContents: "external\n",
          changeBlocks: [
            {
              workingRange: { start: 9, count: 1 },
              headRange: { start: 9, count: 1 },
            },
          ],
        },
      ],
    });
    await openSavedFileChanges(input);
    expect(input.openUncommittedChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingReveal: expect.objectContaining({ line: 9 }),
      })
    );
  });
});
