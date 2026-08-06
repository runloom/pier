import { z } from "zod";
import { commentTargetSchema } from "./base.ts";
import {
  commentProjectListingSchema,
  commentProjectSnapshotSchema,
} from "./document.ts";
import {
  commentAuthorSchema,
  commentFailureSchema,
  commentThreadIdSchema,
} from "./primitives.ts";

const worktreeKeySchema = z.string().min(1).max(65_536);
const commentBodySchema = z
  .string()
  .min(1)
  .max(64 * 1024);

/** 通用无数据写操作结果：updateComment / deleteComment。 */
export const commentVoidOkSchema = z.strictObject({ kind: z.literal("ok") });
export const commentVoidMutationResultSchema = z.union([
  commentVoidOkSchema,
  commentFailureSchema,
]);
export type CommentVoidMutationResult = z.infer<
  typeof commentVoidMutationResultSchema
>;

/* ── comments.list：加载项目快照（懒加载触发点） ───────────────────── */
export const commentsListRequestSchema = z.strictObject({
  worktreeKey: worktreeKeySchema,
});
export type CommentsListRequest = z.infer<typeof commentsListRequestSchema>;

export const commentsListOkSchema = z.strictObject({
  kind: z.literal("ok"),
  snapshot: commentProjectSnapshotSchema,
});
export const commentsListResultSchema = z.union([
  commentsListOkSchema,
  commentFailureSchema,
]);
export type CommentsListResult = z.infer<typeof commentsListResultSchema>;

/* ── comments.listProjects：已知项目清单 ───────────────────────────── */
export const commentsListProjectsRequestSchema = z.strictObject({});
export type CommentsListProjectsRequest = z.infer<
  typeof commentsListProjectsRequestSchema
>;

export const commentsListProjectsOkSchema = z.strictObject({
  kind: z.literal("ok"),
  projects: z.array(commentProjectListingSchema),
});
export const commentsListProjectsResultSchema = z.union([
  commentsListProjectsOkSchema,
  commentFailureSchema,
]);
export type CommentsListProjectsResult = z.infer<
  typeof commentsListProjectsResultSchema
>;

/* ── comments.createThread：建线程 + 单条评论（原子） ──────────────── */
export const commentsCreateThreadRequestSchema = z.strictObject({
  worktreeKey: worktreeKeySchema,
  target: commentTargetSchema,
  body: commentBodySchema,
  author: commentAuthorSchema,
});
export type CommentsCreateThreadRequest = z.infer<
  typeof commentsCreateThreadRequestSchema
>;

export const commentsCreateThreadOkSchema = z.strictObject({
  kind: z.literal("ok"),
  threadId: commentThreadIdSchema,
});
export const commentsCreateThreadResultSchema = z.union([
  commentsCreateThreadOkSchema,
  commentFailureSchema,
]);
export type CommentsCreateThreadResult = z.infer<
  typeof commentsCreateThreadResultSchema
>;

/* ── comments.updateComment：原地改正文（置 editedAt） ─────────────── */
export const commentsUpdateCommentRequestSchema = z.strictObject({
  worktreeKey: worktreeKeySchema,
  threadId: commentThreadIdSchema,
  commentId: z.string().uuid(),
  body: commentBodySchema,
});
export type CommentsUpdateCommentRequest = z.infer<
  typeof commentsUpdateCommentRequestSchema
>;

/* ── comments.deleteComment：软删（置 deletedAt） ──────────────────── */
export const commentsDeleteCommentRequestSchema = z.strictObject({
  worktreeKey: worktreeKeySchema,
  threadId: commentThreadIdSchema,
  commentId: z.string().uuid(),
});
export type CommentsDeleteCommentRequest = z.infer<
  typeof commentsDeleteCommentRequestSchema
>;

/**
 * 评论命令 schema 数组（对齐 gitReviewCommandSchemas 形式）。
 * 经 `...commentsCommandSchemas` 并入 pierCommandSchema，走
 * PIER.COMMAND_EXECUTE → command-router → commands/comments.ts 执行器。
 *
 * v1 瘦身：只保留 list / listProjects / createThread / updateComment /
 * deleteComment。setResolved / addComment / markRead / deleteProject 已砍
 * （对标 Codex 单条批注：无线程回复、无 resolve、无已读回写）。
 */
export const commentsCommandSchemas = [
  z.object({
    request: commentsListRequestSchema,
    type: z.literal("comments.list"),
  }),
  z.object({
    request: commentsListProjectsRequestSchema,
    type: z.literal("comments.listProjects"),
  }),
  z.object({
    request: commentsCreateThreadRequestSchema,
    type: z.literal("comments.createThread"),
  }),
  z.object({
    request: commentsUpdateCommentRequestSchema,
    type: z.literal("comments.updateComment"),
  }),
  z.object({
    request: commentsDeleteCommentRequestSchema,
    type: z.literal("comments.deleteComment"),
  }),
] as const;
