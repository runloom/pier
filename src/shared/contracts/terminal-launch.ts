import { z } from "zod";
import { agentKindSchema } from "./agent.ts";

export const terminalLaunchEnvKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const terminalLaunchOptionsSchema = z
  .object({
    agentId: agentKindSchema.optional(),
    command: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(terminalLaunchEnvKeySchema, z.string()).optional(),
    profileId: z.string().min(1).optional(),
  })
  .strict();

// agentId 保留在 resolved 里：launcher 客户端先验身份直通 agent 会话
// ——native 侧只读 command/cwd/env, 多余字段无害。
export const resolvedTerminalLaunchOptionsSchema =
  terminalLaunchOptionsSchema.omit({
    profileId: true,
  });

export const terminalAgentRestoreLaunchOptionsSchema =
  resolvedTerminalLaunchOptionsSchema.omit({
    env: true,
  });

export type TerminalLaunchOptions = z.infer<typeof terminalLaunchOptionsSchema>;
export type ResolvedTerminalLaunchOptions = z.infer<
  typeof resolvedTerminalLaunchOptionsSchema
>;
export type TerminalAgentRestoreLaunchOptions = z.infer<
  typeof terminalAgentRestoreLaunchOptionsSchema
>;
