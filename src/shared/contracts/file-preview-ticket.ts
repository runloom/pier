import {
  fileRootSchema,
  nonEmptyFileRootRelativePathSchema,
} from "@shared/contracts/file.ts";
import { z } from "zod";

const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/u);

export const filePreviewTicketLocatorSchema = z.object({
  mime: z.string().min(1).max(128),
  path: nonEmptyFileRootRelativePathSchema,
  revision: z.string().min(1),
  root: fileRootSchema,
});
export type FilePreviewTicketLocator = z.infer<
  typeof filePreviewTicketLocatorSchema
>;

export const filePreviewRuntimeAcquireRequestSchema = z.object({
  recordId: z.string().min(1).max(256),
});
export const filePreviewRuntimeAcquireResultSchema = z.discriminatedUnion(
  "acquired",
  [
    z.object({
      acquired: z.literal(true),
      leaseId: opaqueTokenSchema,
      runtimeId: opaqueTokenSchema,
    }),
    z.object({
      acquired: z.literal(false),
      reason: z.enum(["forbidden", "invalid-request", "unavailable"]),
    }),
  ]
);
export type FilePreviewRuntimeAcquireResult = z.infer<
  typeof filePreviewRuntimeAcquireResultSchema
>;

export const filePreviewTicketIssueRequestSchema = z.object({
  leaseId: opaqueTokenSchema,
  locator: filePreviewTicketLocatorSchema,
  previousTicket: opaqueTokenSchema.optional(),
});
export type FilePreviewTicketIssueRequest = z.infer<
  typeof filePreviewTicketIssueRequestSchema
>;

export const filePreviewTicketIssueResultSchema = z.discriminatedUnion(
  "issued",
  [
    z.object({
      expiresAt: z.number().int().nonnegative(),
      issued: z.literal(true),
      ticket: opaqueTokenSchema,
      url: z.string().startsWith("pier-file-preview://file/"),
    }),
    z.object({
      issued: z.literal(false),
      reason: z.enum(["forbidden", "invalid-request", "unavailable"]),
    }),
  ]
);
export type FilePreviewTicketIssueResult = z.infer<
  typeof filePreviewTicketIssueResultSchema
>;

export const filePreviewTicketReleaseRequestSchema = z.object({
  leaseId: opaqueTokenSchema,
  ticket: opaqueTokenSchema,
});
export const filePreviewRuntimeRevokeRequestSchema = z.object({
  leaseId: opaqueTokenSchema,
});
