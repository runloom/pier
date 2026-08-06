import type {
  CommentProjectSnapshot,
  CommentsCreateThreadRequest,
  CommentsCreateThreadResult,
  CommentsDeleteCommentRequest,
  CommentsListProjectsRequest,
  CommentsListProjectsResult,
  CommentsListRequest,
  CommentsListResult,
  CommentsUpdateCommentRequest,
  CommentVoidMutationResult,
} from "@shared/contracts/comments/index.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

/**
 * Renderer 侧访问统一评论能力的 API。
 *
 * 写入方是 main 端 CommentsService；读取走 list（首拉）+ onChanged（订阅广播），
 * seq 单调守卫在 renderer 镜像 store（comments.store.ts）。所有命令经统一
 * PIER.COMMAND_EXECUTE 路由（capability 在 authorizeCommand 校验）。
 * 结果透传 {kind:"ok",...} | CommentFailure 联合（对齐 git-review-api），
 * 调用方按 result.kind 分支。
 *
 * v1 瘦身：只暴露 list / listProjects / createThread / updateComment /
 * deleteComment / onChanged。
 */
export interface PierCommentsAPI {
  createThread: (
    request: CommentsCreateThreadRequest
  ) => Promise<CommentsCreateThreadResult>;
  deleteComment: (
    request: CommentsDeleteCommentRequest
  ) => Promise<CommentVoidMutationResult>;
  /** 首拉项目快照；镜像 store 水合前调一次。失败时 throw（业务错误经 Error）。 */
  ensureLoaded: (worktreeKey: string) => Promise<CommentProjectSnapshot>;
  list: (request: CommentsListRequest) => Promise<CommentsListResult>;
  listProjects: (
    request: CommentsListProjectsRequest
  ) => Promise<CommentsListProjectsResult>;
  /** main → renderer 广播（seq 单调快照）。返回 disposer。 */
  onChanged: (cb: (snapshot: CommentProjectSnapshot) => void) => () => void;
  updateComment: (
    request: CommentsUpdateCommentRequest
  ) => Promise<CommentVoidMutationResult>;
}

export const commentsApi: PierCommentsAPI = {
  createThread: (request) =>
    invokePierCommand<CommentsCreateThreadResult>({
      request,
      type: "comments.createThread",
    }),
  deleteComment: (request) =>
    invokePierCommand<CommentVoidMutationResult>({
      request,
      type: "comments.deleteComment",
    }),
  ensureLoaded: async (worktreeKey) => {
    const result = await invokePierCommand<CommentsListResult>({
      request: { worktreeKey },
      type: "comments.list",
    });
    if (result.kind === "ok") {
      return result.snapshot;
    }
    throw new Error(result.message ?? "comments.list failed");
  },
  list: (request) =>
    invokePierCommand<CommentsListResult>({ request, type: "comments.list" }),
  listProjects: (request) =>
    invokePierCommand<CommentsListProjectsResult>({
      request,
      type: "comments.listProjects",
    }),
  onChanged: (cb) =>
    subscribeIpc<CommentProjectSnapshot>(PIER_BROADCAST.COMMENTS_CHANGED, cb),
  updateComment: (request) =>
    invokePierCommand<CommentVoidMutationResult>({
      request,
      type: "comments.updateComment",
    }),
};
