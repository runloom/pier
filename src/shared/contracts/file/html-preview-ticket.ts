import { fileRootSchema } from "@shared/contracts/file.ts";
import { z } from "zod";

const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/u);

/**
 * HTML 预览票据签发请求：renderer 提供磁盘绝对路径 + jail root，
 * relPath 由 main 在 jail 后计算返回（renderer 不自行拼相对路径）。
 */
export const htmlPreviewTicketIssueRequestSchema = z
  .object({
    path: z.string().min(1).max(4096),
    previousTicket: opaqueTokenSchema.optional(),
    root: fileRootSchema,
  })
  .strict();
export type HtmlPreviewTicketIssueRequest = z.infer<
  typeof htmlPreviewTicketIssueRequestSchema
>;

export const htmlPreviewTicketIssueResultSchema = z.discriminatedUnion(
  "issued",
  [
    z.object({
      issued: z.literal(true),
      relPath: z.string().min(1).max(4096),
      ticket: opaqueTokenSchema,
    }),
    z.object({
      issued: z.literal(false),
      reason: z.enum([
        "forbidden",
        "invalid-request",
        "not-found",
        "outside-root",
        "unavailable",
      ]),
    }),
  ]
);
export type HtmlPreviewTicketIssueResult = z.infer<
  typeof htmlPreviewTicketIssueResultSchema
>;

export const htmlPreviewTicketReleaseRequestSchema = z
  .object({
    ticket: opaqueTokenSchema,
  })
  .strict();
export type HtmlPreviewTicketReleaseRequest = z.infer<
  typeof htmlPreviewTicketReleaseRequestSchema
>;
export const htmlPreviewTicketTouchRequestSchema =
  htmlPreviewTicketReleaseRequestSchema;
export type HtmlPreviewTicketTouchRequest = HtmlPreviewTicketReleaseRequest;
