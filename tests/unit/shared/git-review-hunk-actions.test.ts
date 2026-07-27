import { describe, expect, it, vi } from "vitest";
import {
  applyHunkGitAction,
  tryExtractChangeBlockPatch,
} from "../../../src/plugins/builtin/git/renderer/git-review-hunk-actions.ts";
import { extractHunkPatch } from "../../../src/shared/git-patch-hunk.ts";

const SAMPLE_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
 line3
@@ -10,2 +11,3 @@
 keep
+debug
`;

const MULTI_BLOCK_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,8 +1,10 @@
 keep-a
-old-one
+new-one
 mid-context
-old-two
+new-two
 keep-b
`;

describe("extractHunkPatch (whole @@)", () => {
  it("extracts a single hunk", () => {
    const patch = extractHunkPatch(SAMPLE_PATCH, [1]);
    expect(patch).toContain("+debug");
    expect(patch).not.toContain("+new");
  });

  it("throws for out-of-range index", () => {
    expect(() => extractHunkPatch(SAMPLE_PATCH, [9])).toThrow(/out of range/);
  });
});

describe("tryExtractChangeBlockPatch", () => {
  it("extracts only the selected change island inside a multi-block @@", () => {
    const lower = tryExtractChangeBlockPatch(MULTI_BLOCK_PATCH, 0, 1);
    expect(lower).toContain("+new-two");
    expect(lower).not.toContain("+new-one");
  });
});

describe("applyHunkGitAction", () => {
  it("maps stage to apply --cached (target staged, revert false)", async () => {
    const applyPatch = vi.fn(async () => ({
      status: "success" as const,
    }));
    const result = await applyHunkGitAction({
      action: "stage",
      applyPatch,
      cwd: "/repo",
      filePatch: SAMPLE_PATCH,
      hunkIndex: 0,
      variant: "unstaged",
    });
    expect(result.ok).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(applyPatch).toHaveBeenCalledWith("/repo", {
      atomic: true,
      diff: expect.stringContaining("+new"),
      revert: false,
      target: "staged",
    });
  });

  it("returns extract-failed without English product string", async () => {
    const applyPatch = vi.fn(async () => ({
      status: "success" as const,
    }));
    const result = await applyHunkGitAction({
      action: "stage",
      applyPatch,
      cwd: "/repo",
      filePatch: "not a patch",
      hunkIndex: 0,
      variant: "unstaged",
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("extract-failed");
    expect(result.message).toBeUndefined();
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it("restages when staged revert worktree step fails", async () => {
    const applyPatch = vi
      .fn()
      .mockResolvedValueOnce({ status: "success" as const })
      .mockResolvedValueOnce({
        status: "error" as const,
        message: "worktree reject",
      })
      .mockResolvedValueOnce({ status: "success" as const });
    const result = await applyHunkGitAction({
      action: "revert",
      applyPatch,
      cwd: "/repo",
      filePatch: SAMPLE_PATCH,
      hunkIndex: 0,
      variant: "staged",
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("apply-failed");
    expect(applyPatch).toHaveBeenCalledTimes(3);
    expect(applyPatch.mock.calls[2]?.[1]).toMatchObject({
      revert: false,
      target: "staged",
    });
  });

  it("reports partial-revert-worktree when restage also fails", async () => {
    const applyPatch = vi
      .fn()
      .mockResolvedValueOnce({ status: "success" as const })
      .mockResolvedValueOnce({
        status: "error" as const,
        message: "worktree reject",
      })
      .mockResolvedValueOnce({
        status: "error" as const,
        message: "restage reject",
      });
    const result = await applyHunkGitAction({
      action: "revert",
      applyPatch,
      cwd: "/repo",
      filePatch: SAMPLE_PATCH,
      hunkIndex: 0,
      variant: "staged",
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("partial-revert-worktree");
  });

  it("stages only the clicked change block in a multi-island @@", async () => {
    const applyPatch = vi.fn(async () => ({
      status: "success" as const,
    }));
    await applyHunkGitAction({
      action: "stage",
      applyPatch,
      changeBlockIndex: 1,
      cwd: "/repo",
      filePatch: MULTI_BLOCK_PATCH,
      hunkIndex: 0,
      variant: "unstaged",
    });
    const diff = applyPatch.mock.calls[0]?.[1]?.diff as string;
    expect(diff).toContain("+new-two");
    expect(diff).not.toContain("+new-one");
  });

  it("maps unstage to reverse --cached", async () => {
    const applyPatch = vi.fn(async () => ({
      status: "success" as const,
    }));
    await applyHunkGitAction({
      action: "unstage",
      applyPatch,
      cwd: "/repo",
      filePatch: SAMPLE_PATCH,
      hunkIndex: 0,
      variant: "staged",
    });
    expect(applyPatch).toHaveBeenCalledWith("/repo", {
      atomic: true,
      diff: expect.any(String),
      revert: true,
      target: "staged",
    });
  });

  it("maps staged revert to two apply steps", async () => {
    const applyPatch = vi.fn(async () => ({
      status: "success" as const,
    }));
    await applyHunkGitAction({
      action: "revert",
      applyPatch,
      cwd: "/repo",
      filePatch: SAMPLE_PATCH,
      hunkIndex: 0,
      variant: "staged",
    });
    expect(applyPatch).toHaveBeenCalledTimes(2);
    expect(applyPatch.mock.calls[0]?.[1]).toMatchObject({
      revert: true,
      target: "staged",
    });
    expect(applyPatch.mock.calls[1]?.[1]).toMatchObject({
      revert: true,
      target: "unstaged",
    });
  });
});
