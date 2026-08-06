import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useReviewComments } from "@plugins/builtin/git/renderer/hooks/use-review-comments.ts";
import type {
  CommentItem,
  CommentThread,
} from "@shared/contracts/comments/base.ts";
import type { CommentProjectSnapshot } from "@shared/contracts/comments/document.ts";
import type { GitReviewScope } from "@shared/contracts/git/review.ts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

function scope(gitRootPath = "/repo"): GitReviewScope {
  return {
    contextId: "ctx:abc",
    gitRootPath,
    target: { kind: "uncommitted" },
  };
}

function makeComment(id: string): CommentItem {
  return {
    author: { kind: "user" },
    body: `comment ${id}`,
    createdAt: 1000,
    id,
  };
}

function makeDiffThread(threadId: string, path = "src/a.ts"): CommentThread {
  return {
    comments: [makeComment("c1")],
    createdAt: 1000,
    id: threadId,
    state: "open",
    target: {
      kind: "git-diff",
      group: "unstaged",
      line: 5,
      oldPath: null,
      path,
      scope: scope(),
      side: "new",
    },
    updatedAt: 2000,
  };
}

function makeSnapshot(
  seq: number,
  threads: CommentThread[] = [],
  worktreeKey = "/repo"
): CommentProjectSnapshot {
  return {
    readState: { lastReadAt: 1000 },
    seq,
    threads,
    worktreeKey,
  };
}

interface CommentsMock {
  readonly snapshot: ReturnType<typeof vi.fn>;
  readonly watch: ReturnType<typeof vi.fn>;
}

function makeContext(mock: CommentsMock): RendererPluginContext {
  return { comments: mock } as unknown as RendererPluginContext;
}

it("首拉 snapshot 投影 threads 并暴露 seq", async () => {
  const snapshot = vi.fn(async () => makeSnapshot(7, [makeDiffThread("t1")]));
  const watch = vi.fn(() => vi.fn());
  const context = makeContext({ snapshot, watch });
  const { result } = renderHook(() => useReviewComments(context, scope()));
  await waitFor(() => expect(result.current.commentsIndex).not.toBeNull());
  expect(result.current.commentsSeq).toBe(7);
  expect(result.current.commentsIndex?.size).toBe(1);
  expect(
    result.current.commentsIndex?.get("unstaged", "src/a.ts")
  ).toHaveLength(1);
});

it("watch 推送更大 seq 更新投影", async () => {
  let listener: ((snapshot: CommentProjectSnapshot) => void) | null = null;
  const snapshot = vi.fn(async () => makeSnapshot(1, [makeDiffThread("t1")]));
  const watch = vi.fn(
    (_key: string, cb: (snapshot: CommentProjectSnapshot) => void) => {
      listener = cb;
      return vi.fn();
    }
  );
  const context = makeContext({ snapshot, watch });
  const { result } = renderHook(() => useReviewComments(context, scope()));
  await waitFor(() => expect(result.current.commentsSeq).toBe(1));
  act(() => {
    listener?.(
      makeSnapshot(2, [makeDiffThread("t1"), makeDiffThread("t2", "src/b.ts")])
    );
  });
  await waitFor(() => expect(result.current.commentsIndex?.size).toBe(2));
  expect(result.current.commentsSeq).toBe(2);
});

it("stale seq 不覆盖新 seq", async () => {
  let listener: ((snapshot: CommentProjectSnapshot) => void) | null = null;
  const snapshot = vi.fn(async () => makeSnapshot(5, [makeDiffThread("t1")]));
  const watch = vi.fn(
    (_key: string, cb: (snapshot: CommentProjectSnapshot) => void) => {
      listener = cb;
      return vi.fn();
    }
  );
  const context = makeContext({ snapshot, watch });
  const { result } = renderHook(() => useReviewComments(context, scope()));
  await waitFor(() => expect(result.current.commentsSeq).toBe(5));
  act(() => {
    listener?.(makeSnapshot(3, [makeDiffThread("t9", "src/stale.ts")]));
  });
  expect(result.current.commentsSeq).toBe(5);
  expect(result.current.commentsIndex?.size).toBe(1);
  expect(result.current.commentsIndex?.get("unstaged", "src/stale.ts")).toEqual(
    []
  );
});

it("切 worktree 清空旧评论并重新订阅新项目", async () => {
  const snapshot = vi.fn(async (key: string) =>
    makeSnapshot(
      key === "/repo-a" ? 1 : 9,
      [makeDiffThread("t1", key === "/repo-a" ? "a.ts" : "b.ts")],
      key
    )
  );
  const watchers = new Map<
    string,
    (snapshot: CommentProjectSnapshot) => void
  >();
  const watch = vi.fn(
    (key: string, cb: (snapshot: CommentProjectSnapshot) => void) => {
      watchers.set(key, cb);
      return vi.fn();
    }
  );
  const context = makeContext({ snapshot, watch });
  const hook = renderHook(({ scp }) => useReviewComments(context, scp), {
    initialProps: { scp: scope("/repo-a") },
  });
  await waitFor(() => expect(hook.result.current.commentsSeq).toBe(1));
  expect(
    hook.result.current.commentsIndex?.get("unstaged", "a.ts")
  ).toHaveLength(1);
  hook.rerender({ scp: scope("/repo-b") });
  await waitFor(() => expect(hook.result.current.commentsSeq).toBe(9));
  expect(
    hook.result.current.commentsIndex?.get("unstaged", "b.ts")
  ).toHaveLength(1);
  // 旧项目评论已清空
  expect(hook.result.current.commentsIndex?.get("unstaged", "a.ts")).toEqual(
    []
  );
  // 旧项目 watcher 推送不再影响（disposed guard）
  act(() => {
    watchers.get("/repo-a")?.(
      makeSnapshot(2, [makeDiffThread("t2", "a.ts")], "/repo-a")
    );
  });
  expect(hook.result.current.commentsSeq).toBe(9);
});

it("首拉失败返回 null 时保持空态，watch 后续推送仍生效", async () => {
  let listener: ((snapshot: CommentProjectSnapshot) => void) | null = null;
  const snapshot = vi.fn(async () => null);
  const watch = vi.fn(
    (_key: string, cb: (snapshot: CommentProjectSnapshot) => void) => {
      listener = cb;
      return vi.fn();
    }
  );
  const context = makeContext({ snapshot, watch });
  const { result } = renderHook(() => useReviewComments(context, scope()));
  await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
  expect(result.current.commentsIndex).toBeNull();
  expect(result.current.commentsSeq).toBe(0);
  act(() => {
    listener?.(makeSnapshot(4, [makeDiffThread("t1")]));
  });
  await waitFor(() => expect(result.current.commentsSeq).toBe(4));
  expect(result.current.commentsIndex?.size).toBe(1);
});

it("unmount 取消订阅", async () => {
  const dispose = vi.fn();
  const snapshot = vi.fn(async () => makeSnapshot(1, [makeDiffThread("t1")]));
  const watch = vi.fn(() => dispose);
  const context = makeContext({ snapshot, watch });
  const { unmount } = renderHook(() => useReviewComments(context, scope()));
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});
