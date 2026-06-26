import { z } from "zod";

export const terminalLaunchEnvKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const terminalLaunchOptionsSchema = z
  .object({
    command: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(terminalLaunchEnvKeySchema, z.string()).optional(),
    profileId: z.string().min(1).optional(),
  })
  .strict();

export const resolvedTerminalLaunchOptionsSchema =
  terminalLaunchOptionsSchema.omit({
    profileId: true,
  });

export type TerminalLaunchOptions = z.infer<typeof terminalLaunchOptionsSchema>;
export type ResolvedTerminalLaunchOptions = z.infer<
  typeof resolvedTerminalLaunchOptionsSchema
>;
