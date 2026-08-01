import type { GitReviewScope } from "@shared/contracts/git/review.ts";
import { describe, expect, it, vi } from "vitest";
import { GitReviewMutationAuthority } from "../../../../../src/plugins/builtin/git/renderer/review/mutation-authority.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const uncommitted: GitReviewScope = {
  contextId: "worktree:test",
  gitRootPath: "/repo",
  target: { kind: "uncommitted" },
};
const branch: GitReviewScope = {
  ...uncommitted,
  target: { kind: "branch", ref: "main" },
};

describe("GitReviewMutationAuthority", () => {
  it("同仓多个 Review 面板共享一个修改权限并等待全部权威刷新", async () => {
    const authority = new GitReviewMutationAuthority();
    const firstRefresh = deferred();
    const secondRefresh = deferred();
    const first = vi.fn(() => firstRefresh.promise);
    const second = vi.fn(() => secondRefresh.promise);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    authority.subscribe(uncommitted, firstListener);
    authority.subscribe(branch, secondListener);
    authority.registerRefresher(uncommitted, first);
    authority.registerRefresher(branch, second);

    expect(authority.acquire(uncommitted)).toBe(true);
    expect(authority.acquire(branch)).toBe(false);
    expect(authority.blocked(branch)).toBe(true);
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();

    let released = false;
    const barrier = authority.refreshAndRelease(uncommitted).then(() => {
      released = true;
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    firstRefresh.resolve();
    await firstRefresh.promise;
    expect(released).toBe(false);
    expect(authority.blocked(uncommitted)).toBe(true);

    secondRefresh.resolve();
    await barrier;
    expect(released).toBe(true);
    expect(authority.blocked(uncommitted)).toBe(false);
    expect(authority.blocked(branch)).toBe(false);
  });
});
