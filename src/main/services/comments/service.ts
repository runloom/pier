/**
 * CommentsService：评论 main 侧唯一写入方（设计文档 §3、§6）。
 *
 * - per-worktree versionedJsonStore 缓存 + per-worktree seq 单调。
 * - 每次写操作：mutate store → seq += 1 → broadcast(snapshot)。
 * - 身份校验：createThread 校验 scope 与 worktreeKey 派生一致（identity.ts）。
 * - 广播经 deps.broadcast 注入，解耦 window-broadcasts（对齐 NCS service 模式）。
 *
 * v1 瘦身（对标 Codex 单条批注）：只保留 list / listProjects / createThread /
 * updateComment / deleteComment。存储 schema 仍冻结 version:1（state 恒 open、
 * comments 恒 1 条）。
 */
import { randomUUID } from "node:crypto";
import type {
  CommentsCreateThreadRequest,
  CommentsDeleteCommentRequest,
  CommentsListProjectsRequest,
  CommentsListRequest,
  CommentsUpdateCommentRequest,
} from "@shared/contracts/comments/index.ts";
import {
  type CommentFailure,
  type CommentProjectListing,
  type CommentProjectSnapshot,
  type CommentProjectStore,
  type CommentThread,
  commentFailureSchema,
} from "@shared/contracts/comments/index.ts";
import type { DebouncedJsonStore } from "../../state/debounced-store.ts";
import { assertCommentTarget } from "./identity.ts";
import { createCommentProjectStore, listCommentProjectFiles } from "./store.ts";

export interface CommentsService {
  createThread(
    request: CommentsCreateThreadRequest
  ): Promise<{ kind: "ok"; threadId: string } | CommentFailure>;
  deleteComment(
    request: CommentsDeleteCommentRequest
  ): Promise<{ kind: "ok" } | CommentFailure>;
  flush(): Promise<void>;
  list(
    request: CommentsListRequest
  ): Promise<{ kind: "ok"; snapshot: CommentProjectSnapshot } | CommentFailure>;
  listProjects(
    request: CommentsListProjectsRequest
  ): Promise<
    { kind: "ok"; projects: CommentProjectListing[] } | CommentFailure
  >;
  updateComment(
    request: CommentsUpdateCommentRequest
  ): Promise<{ kind: "ok" } | CommentFailure>;
}

export interface CommentsServiceDeps {
  broadcast: (snapshot: CommentProjectSnapshot) => void;
  idGen?: () => string;
  now?: () => number;
  userDataDir: string;
}

export function createCommentsService(
  deps: CommentsServiceDeps
): CommentsService {
  const now = deps.now ?? Date.now;
  const idGen = deps.idGen ?? randomUUID;
  const stores = new Map<string, DebouncedJsonStore<CommentProjectStore>>();
  const seqs = new Map<string, number>();

  async function ensureStore(
    worktreeKey: string
  ): Promise<DebouncedJsonStore<CommentProjectStore>> {
    let store = stores.get(worktreeKey);
    if (!store) {
      store = createCommentProjectStore(worktreeKey, deps.userDataDir);
      await store.init();
      stores.set(worktreeKey, store);
      seqs.set(worktreeKey, 0);
    }
    return store;
  }

  function snapshot(worktreeKey: string): CommentProjectSnapshot {
    const store = stores.get(worktreeKey);
    if (!store) {
      return {
        worktreeKey,
        threads: [],
        readState: { lastReadAt: 0 },
        seq: 0,
      };
    }
    const data = store.get();
    return {
      worktreeKey,
      threads: data.threads,
      readState: data.readState,
      seq: seqs.get(worktreeKey) ?? 0,
    };
  }

  function publish(worktreeKey: string): void {
    const next = (seqs.get(worktreeKey) ?? 0) + 1;
    seqs.set(worktreeKey, next);
    deps.broadcast(snapshot(worktreeKey));
  }

  function fail(
    reason: CommentFailure["reason"],
    message: string,
    retryable = false
  ): CommentFailure {
    return commentFailureSchema.parse({
      kind: "error",
      message,
      reason,
      retryable,
    });
  }

  function findThread(
    store: DebouncedJsonStore<CommentProjectStore>,
    threadId: string
  ): CommentThread | undefined {
    return store.get().threads.find((thread) => thread.id === threadId);
  }

  return {
    flush: async () => {
      await Promise.all([...stores.values()].map((store) => store.flush()));
    },

    list: async (request) => {
      await ensureStore(request.worktreeKey);
      return { kind: "ok", snapshot: snapshot(request.worktreeKey) };
    },

    listProjects: async () => {
      const projects = await listCommentProjectFiles(deps.userDataDir);
      return { kind: "ok", projects };
    },

    createThread: async (request) => {
      const targetError = assertCommentTarget(
        request.worktreeKey,
        request.target
      );
      if (targetError) {
        return targetError;
      }
      const store = await ensureStore(request.worktreeKey);
      const ts = now();
      const threadId = idGen();
      const thread: CommentThread = {
        id: threadId,
        target: request.target,
        state: "open",
        createdAt: ts,
        updatedAt: ts,
        comments: [
          {
            id: idGen(),
            author: request.author,
            body: request.body,
            createdAt: ts,
          },
        ],
      };
      store.mutate((state) => ({
        ...state,
        threads: [thread, ...state.threads],
      }));
      publish(request.worktreeKey);
      return { kind: "ok", threadId };
    },

    updateComment: async (request) => {
      const store = await ensureStore(request.worktreeKey);
      const existing = findThread(store, request.threadId);
      if (!existing) {
        return fail("threadNotFound", `线程不存在: ${request.threadId}`);
      }
      const target = existing.comments.find((c) => c.id === request.commentId);
      if (!target || target.deletedAt !== undefined) {
        return fail("commentNotFound", `评论不存在: ${request.commentId}`);
      }
      const ts = now();
      store.mutate((state) => ({
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === request.threadId
            ? {
                ...thread,
                updatedAt: ts,
                comments: thread.comments.map((c) =>
                  c.id === request.commentId
                    ? { ...c, body: request.body, editedAt: ts }
                    : c
                ),
              }
            : thread
        ),
      }));
      publish(request.worktreeKey);
      return { kind: "ok" };
    },

    deleteComment: async (request) => {
      const store = await ensureStore(request.worktreeKey);
      const existing = findThread(store, request.threadId);
      if (!existing) {
        return fail("threadNotFound", `线程不存在: ${request.threadId}`);
      }
      if (!existing.comments.some((c) => c.id === request.commentId)) {
        return fail("commentNotFound", `评论不存在: ${request.commentId}`);
      }
      const ts = now();
      // 单条批注：软删评论后整线程从列表移除（锚点上不再有有效评论）。
      store.mutate((state) => ({
        ...state,
        threads: state.threads
          .map((thread) =>
            thread.id === request.threadId
              ? {
                  ...thread,
                  updatedAt: ts,
                  comments: thread.comments.map((c) =>
                    c.id === request.commentId ? { ...c, deletedAt: ts } : c
                  ),
                }
              : thread
          )
          .filter((thread) =>
            thread.comments.some((c) => c.deletedAt === undefined)
          ),
      }));
      publish(request.worktreeKey);
      return { kind: "ok" };
    },
  };
}
