import { z } from "zod";
import { gitReviewScopeSchema } from "./base.ts";
import { gitReviewFileDocumentRequestSchema } from "./document.ts";
import {
  gitReviewChangeKeySchema,
  gitReviewFailureSchema,
  gitReviewOperationIdSchema,
  gitReviewRelativePathSchema,
  gitReviewRevisionSchema,
  gitReviewSectionKeySchema,
} from "./primitives.ts";

export const gitReviewIndexRequestSchema = z.strictObject({
  operationId: gitReviewOperationIdSchema,
  source: gitReviewScopeSchema,
});
export type GitReviewIndexRequest = z.infer<typeof gitReviewIndexRequestSchema>;

export const gitReviewCancelRequestSchema = z.strictObject({
  operationId: gitReviewOperationIdSchema,
});
export type GitReviewCancelRequest = z.infer<
  typeof gitReviewCancelRequestSchema
>;

export const gitReviewMutationRequestSchema = z.strictObject({
  action: z.enum(["stage", "unstage", "revert"]),
  /**
   * 乐观并发令牌（正文内容哈希）。
   *
   * 只有「需要 renderer 曾看见过确切内容」的写入才必须携带：
   * hunk 级改写（`target.kind === "change"`，要靠 patch evidence 应用）和
   * 文件级 revert（破坏性，会丢掉读取后的新编辑）。
   *
   * 文件级 stage / unstage 省略：它们是路径操作（`git add` / `git reset --`），
   * 与正文无关；main 侧在写入前本来就会重新读一遍文档并校验 group 一致性，
   * 安全性来自那次新鲜读取，不是 renderer 手里的令牌。业界（VS Code、Magit、
   * lazygit 等）在文件级暂存上同样不做内容令牌校验。要求它只会让按钮在正文
   * 读回前一直不可用——大仓折叠全部后表现为按钮逐个解锁。
   */
  expectedRevision: gitReviewRevisionSchema.optional(),
  operationId: gitReviewOperationIdSchema,
  source: gitReviewFileDocumentRequestSchema.shape.source,
  target: z.discriminatedUnion("kind", [
    z.strictObject({
      changeKey: gitReviewChangeKeySchema,
      kind: z.literal("change"),
      sectionKey: gitReviewSectionKeySchema,
    }),
    z.strictObject({
      kind: z.literal("file"),
      sectionKey: gitReviewSectionKeySchema,
    }),
  ]),
});
export type GitReviewMutationRequest = z.infer<
  typeof gitReviewMutationRequestSchema
>;

export const gitReviewPathMutationRequestSchema = z.strictObject({
  action: z.enum(["stage", "unstage", "revert"]),
  expectedIndexRevision: gitReviewRevisionSchema,
  operationId: gitReviewOperationIdSchema,
  paths: z
    .array(gitReviewRelativePathSchema)
    .min(1)
    .max(10_000)
    .refine(
      (paths) => new Set(paths).size === paths.length,
      "Git Review mutation paths must be unique"
    ),
  source: gitReviewScopeSchema,
});
export type GitReviewPathMutationRequest = z.infer<
  typeof gitReviewPathMutationRequestSchema
>;

export const gitReviewMutationOkSchema = z.strictObject({
  kind: z.literal("ok"),
  operationId: gitReviewOperationIdSchema,
  /** ack 只标识本次写入所属状态序列，不携带 UI 快照。 */
  stateSequence: z.number().int().nonnegative().optional(),
});
export type GitReviewMutationOk = z.infer<typeof gitReviewMutationOkSchema>;

export const gitReviewMutationResultSchema = z.union([
  gitReviewMutationOkSchema,
  gitReviewFailureSchema,
]);
export type GitReviewMutationResult = z.infer<
  typeof gitReviewMutationResultSchema
>;

export const gitReviewCommandSchemas = [
  z.object({
    request: gitReviewIndexRequestSchema,
    type: z.literal("git.getReviewIndex"),
  }),
  z.object({
    request: gitReviewFileDocumentRequestSchema,
    type: z.literal("git.getReviewFileDocument"),
  }),
  z.object({
    request: gitReviewCancelRequestSchema,
    type: z.literal("git.cancelReviewRequest"),
  }),
  z.object({
    request: gitReviewMutationRequestSchema,
    type: z.literal("git.applyReviewMutation"),
  }),
  z.object({
    request: gitReviewPathMutationRequestSchema,
    type: z.literal("git.applyReviewPathMutation"),
  }),
] as const;
