import { z } from "zod";

export const shellEnvironmentHostStatusSchema = z.object({
  cacheHit: z.boolean().optional(),
  cwd: z.string().optional(),
  disabled: z.boolean(),
  /** Last dump attempt duration in milliseconds. */
  durationMs: z.number().int().nonnegative().optional(),
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
  /** Why dump was skipped when status is skipped. */
  skipReason: z.enum(["cli", "disabled", "no-shell", "windows"]).optional(),
  timeoutMs: z.number().int().positive(),
});

export type ShellEnvironmentHostStatus = z.infer<
  typeof shellEnvironmentHostStatusSchema
>;
