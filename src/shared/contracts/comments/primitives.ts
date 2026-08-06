import { z } from "zod";

/** 评论线程 id 与条目 id：uuid，跨项目唯一。 */
export const commentThreadIdSchema = z.string().uuid();
export const commentIdSchema = z.string().uuid();

/** Unix 毫秒时间戳；非负整数。createdAt/updatedAt/editedAt/deletedAt/lastReadAt 共用。 */
export const commentTimestampSchema = z.number().int().nonnegative();

/**
 * 评论锚点类型完整枚举（forward-compat）。
 *
 * schema 层（commentTargetSchema）v1 只注册 git 两种；code / markdown / canvas
 * 只在此枚举占位，待对应消费端落地时经版本迁移加入（设计文档 §9）。把枚举与
 * schema 分离，让「未来支持」的类型在类型层可见、在 zod 校验层被拒绝，
 * 避免半生不熟的 target 流入存储。
 */
export const COMMENT_TARGET_KINDS = [
  "git-diff",
  "git-file",
  "code",
  "markdown",
  "canvas",
] as const;
export const commentTargetKindSchema = z.enum(COMMENT_TARGET_KINDS);
export type CommentTargetKind = z.infer<typeof commentTargetKindSchema>;

/**
 * 评论作者：用户与智能体双向（设计文档 §4.4）。
 *
 * 判别联合按 kind 分派。agent 侧 agentId 是稳定 id，displayName 是快照——
 * 智能体可被删除/改名，评论不随主体消亡。本地单用户应用不做主体校验，
 * agent 评论由插件门面按其 agentId 传入，main 侧只校验格式。
 */
export const commentAuthorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({
    kind: z.literal("agent"),
    agentId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
  }),
]);
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

/** 评论操作失败原因：稳定用户文案映射键；message 只承载有界技术诊断。 */
export const commentFailureReasonSchema = z.enum([
  "invalidSource",
  "threadNotFound",
  "commentNotFound",
  "targetImmutable",
  "internal",
]);
export type CommentFailureReason = z.infer<typeof commentFailureReasonSchema>;

export const commentFailureSchema = z.strictObject({
  kind: z.literal("error"),
  message: z.string().max(4096).nullable(),
  reason: commentFailureReasonSchema,
  retryable: z.boolean(),
});
export type CommentFailure = z.infer<typeof commentFailureSchema>;

/**
 * 阅读状态：与线程工作流状态（open/resolved）正交，项目级粗粒度
 * （设计文档 §4.7）。未读判定：thread.updatedAt > lastReadAt 且存在未删除条目。
 * thread 级 readAt 是 v1.1 可选细化，届时经版本迁移加入，不在 v1 设字段。
 */
export const commentReadStateSchema = z.strictObject({
  lastReadAt: commentTimestampSchema,
});
export type CommentReadState = z.infer<typeof commentReadStateSchema>;
