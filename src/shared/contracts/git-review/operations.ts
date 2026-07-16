import { z } from "zod";
import { gitReviewScopeSchema } from "./base.ts";
import { gitReviewFileDocumentRequestSchema } from "./document.ts";
import { gitReviewOperationIdSchema } from "./primitives.ts";

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
] as const;
