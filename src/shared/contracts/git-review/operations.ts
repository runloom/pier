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
  expectedRevision: gitReviewRevisionSchema,
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
