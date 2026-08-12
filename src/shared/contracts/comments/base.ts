import { z } from "zod";
import { gitReviewScopeSchema } from "../git-review/base.ts";
import {
  GIT_REVIEW_GROUP_ORDER,
  gitReviewRelativePathSchema,
} from "../git-review/primitives.ts";
import {
  commentAuthorSchema,
  commentIdSchema,
  commentReadStateSchema,
  commentThreadIdSchema,
  commentTimestampSchema,
} from "./primitives.ts";

/**
 * 评论锚定的 git 身份：直接复用 gitReviewScopeSchema
 * （{ contextId, gitRootPath, target }），保证评论身份与 review 文档身份同源
 * （contextId + gitRootPath 双重校验）。设计文档 §4.5：评论身份与 review 文档
 * 身份共用一份契约，避免两套 canonicalize 漂移。
 */
export const gitCommentScopeSchema = gitReviewScopeSchema;
export type GitCommentScope = z.infer<typeof gitCommentScopeSchema>;

/** blob OID：40 位 hex（git SHA-1）。版本判定的确定性指纹（设计文档 §4.6）。 */
const blobOidSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/u, "Expected a 40-char hex blob OID");

/**
 * diff 行内评论锚点（设计文档 §4.5）。
 *
 * - group 对齐 review render slot：unstaged/staged/conflict/committed。
 *   同文件同行的 staged 与 unstaged 是两套 diff，group 是必要消歧字段。
 * - line 是 1-based 行号（对应 side 一侧）；线程创建后不可变，漂移判定靠
 *   blobOid 比对而非改写 line。
 * - blobOid 是版本判定的确定性指纹：渲染时 blob 一致 → 行号精确；
 *   不一致 → UI 标记「代码已修改」并降级到文件级折叠区（§4.6）。
 * - anchor 预留 v2 模糊重锚定（行内容 + 前后 N 行摘要 hash），v1 不启用。
 */
export const gitDiffCommentTargetSchema = z.strictObject({
  kind: z.literal("git-diff"),
  scope: gitCommentScopeSchema,
  group: z.enum(GIT_REVIEW_GROUP_ORDER),
  path: gitReviewRelativePathSchema,
  oldPath: gitReviewRelativePathSchema.nullable(),
  side: z.enum(["old", "new"]),
  line: z.number().int().positive(),
  blobOid: blobOidSchema.optional(),
  anchor: z.string().max(256).optional(),
});
export type GitDiffCommentTarget = z.infer<typeof gitDiffCommentTargetSchema>;

/** 文件级评论锚点：锚文件而非行，用于文件级讨论与漂移兜底展示。 */
export const gitFileCommentTargetSchema = z.strictObject({
  kind: z.literal("git-file"),
  scope: gitCommentScopeSchema,
  path: gitReviewRelativePathSchema,
});
export type GitFileCommentTarget = z.infer<typeof gitFileCommentTargetSchema>;

/**
 * Markdown 预览块锚点（设计 2026-08-11）。
 * contentHash + excerpt 创建时必填；headingId 可选；行号不可单独当精确附着证据。
 */
export const markdownCommentTargetSchema = z
  .strictObject({
    kind: z.literal("markdown"),
    path: gitReviewRelativePathSchema,
    headingId: z.string().min(1).max(256).optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    contentHash: z.string().min(1).max(128),
    excerpt: z.string().min(1).max(500),
  })
  .superRefine((target, context) => {
    if (target.endLine !== undefined && target.endLine < target.startLine) {
      context.addIssue({
        code: "custom",
        message: "endLine must be >= startLine",
        path: ["endLine"],
      });
    }
  });
export type MarkdownCommentTarget = z.infer<typeof markdownCommentTargetSchema>;

/**
 * Canvas 预览锚点：无 anchorId = 文件级；有 anchorId = 声明式节点级。
 * excerpt/label 可选（步骤 3 消费端可再收紧）。
 */
export const canvasCommentTargetSchema = z.strictObject({
  kind: z.literal("canvas"),
  path: gitReviewRelativePathSchema,
  anchorId: z.string().min(1).max(256).optional(),
  label: z.string().min(1).max(256).optional(),
  excerpt: z.string().min(1).max(500).optional(),
});
export type CanvasCommentTarget = z.infer<typeof canvasCommentTargetSchema>;

/**
 * 评论锚点判别联合。
 * git-diff / git-file / markdown / canvas 已注册；code 仍仅在 kind 枚举占位。
 */
export const commentTargetSchema = z.discriminatedUnion("kind", [
  gitDiffCommentTargetSchema,
  gitFileCommentTargetSchema,
  markdownCommentTargetSchema,
  canvasCommentTargetSchema,
]);
export type CommentTarget = z.infer<typeof commentTargetSchema>;

/** 评论条目（设计文档 §4.3）。v1 无嵌套回复；replyTo 预留 v2。 */
export const commentItemSchema = z.strictObject({
  id: commentIdSchema,
  author: commentAuthorSchema,
  /** markdown 正文。 */
  body: z
    .string()
    .min(1)
    .max(64 * 1024),
  createdAt: commentTimestampSchema,
  /** 编辑时间戳：置位表示已编辑。 */
  editedAt: commentTimestampSchema.optional(),
  /** 软删标记：保留作者与时间用于审计，UI 显示「已删除」。 */
  deletedAt: commentTimestampSchema.optional(),
  /** 预留：嵌套回复目标（v2）；v1 恒缺省。 */
  replyTo: commentIdSchema.optional(),
});
export type CommentItem = z.infer<typeof commentItemSchema>;

/** 评论线程（设计文档 §4.2）：一个锚点一个线程，线程内评论扁平排列。 */
export const commentThreadSchema = z.strictObject({
  /** uuid，跨项目唯一。 */
  id: commentThreadIdSchema,
  /** 锚点：线程创建后不可变。 */
  target: commentTargetSchema,
  /** 工作流状态：open（未解决）/ resolved（已解决）。与阅读状态正交。 */
  state: z.enum(["open", "resolved"]),
  createdAt: commentTimestampSchema,
  /** 最后一条评论时间或状态变更时间：排序与未读判定的单一来源。 */
  updatedAt: commentTimestampSchema,
  comments: z.array(commentItemSchema),
  /** 创建时的面板上下文 id（审计用，可选）。 */
  originContextId: z.string().max(64).optional(),
});
export type CommentThread = z.infer<typeof commentThreadSchema>;

/**
 * 单项目存储顶层（设计文档 §4.1 + §4.7）。
 *
 * - worktreeKey 是项目区分主键：绝对路径（git worktree 根或项目根），
 *   与 PanelContext.worktreeKey 同源。contextId（ctx:<sha256[:16]>）由
 *   panel-context-resolver 稳定派生，不单独持久化（§5）。
 * - readState 是项目级阅读状态，与 threads 同文件存储。
 */
export const commentProjectStoreSchema = z.strictObject({
  version: z.literal(1),
  worktreeKey: z.string().min(1).max(65_536),
  threads: z.array(commentThreadSchema),
  readState: commentReadStateSchema,
});
export type CommentProjectStore = z.infer<typeof commentProjectStoreSchema>;
