import { z } from "zod";

export const appUpdateStateSchema = z.enum([
  "disabled",
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "error",
]);
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;

export const appUpdateProgressSchema = z.object({
  percent: z.number().min(0).max(100),
});
export type AppUpdateProgress = z.infer<typeof appUpdateProgressSchema>;

export const appUpdateSnapshotSchema = z.object({
  availableVersion: z.string().min(1).optional(),
  currentVersion: z.string().min(1),
  error: z.string().min(1).optional(),
  progress: appUpdateProgressSchema.optional(),
  state: appUpdateStateSchema,
});
export type AppUpdateSnapshot = z.infer<typeof appUpdateSnapshotSchema>;
