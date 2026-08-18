import { z } from "zod";

export const appCliActionSchema = z.enum(["status", "install", "uninstall"]);
export type AppCliAction = z.infer<typeof appCliActionSchema>;

export const appCliActionErrorSchema = z.enum([
  "cancelled",
  "conflict",
  "dev",
  "failed",
  "missing-source",
  "unsupported-platform",
]);
export type AppCliActionError = z.infer<typeof appCliActionErrorSchema>;

export const appCliSnapshotSchema = z.object({
  action: appCliActionSchema,
  actionError: appCliActionErrorSchema.nullable(),
  actionOk: z.boolean(),
  conflictPath: z.string().nullable(),
  detail: z.string().nullable(),
  installed: z.boolean(),
  linkPath: z.string().nullable(),
  needsAdmin: z.boolean(),
  sourcePath: z.string().nullable(),
});
export type AppCliSnapshot = z.infer<typeof appCliSnapshotSchema>;

export const appCliStatusRequestSchema = z.object({
  type: z.literal("app.cli.status"),
});

export const appCliInstallRequestSchema = z.object({
  allowAdmin: z.boolean().optional(),
  type: z.literal("app.cli.install"),
});

export const appCliUninstallRequestSchema = z.object({
  allowAdmin: z.boolean().optional(),
  type: z.literal("app.cli.uninstall"),
});
