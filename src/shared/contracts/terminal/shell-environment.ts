import { z } from "zod";

export const shellEnvironmentHostStatusSchema = z.object({
  cacheHit: z.boolean().optional(),
  cwd: z.string().optional(),
  disabled: z.boolean(),
  dumpMode: z.enum(["login-interactive", "non-login-fallback"]).optional(),
  error: z.string().optional(),
  hostAppliedStatus: z
    .enum(["applied", "not-applied", "stale-after-fail"])
    .optional(),
  pathChanged: z.boolean().optional(),
  platform: z.string(),
  shell: z.string().optional(),
  shellEnvStatus: z
    .enum(["cached", "failed", "resolved", "skipped"])
    .optional(),
  timeoutMs: z.number().int().positive(),
});

export type ShellEnvironmentHostStatus = z.infer<
  typeof shellEnvironmentHostStatusSchema
>;
