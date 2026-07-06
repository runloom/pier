import { z } from "zod";

export const agentAccountProviderSchema = z.enum(["codex"]);
export type AgentAccountProviderId = z.infer<typeof agentAccountProviderSchema>;

export const agentAccountSchema = z.object({
  createdAt: z.number(),
  email: z.string().min(1),
  id: z.string().min(1),
  lastAuthenticatedAt: z.number().optional(),
  planType: z.string().min(1).optional(),
  provider: agentAccountProviderSchema,
  providerAccountId: z.string().min(1).optional(),
  updatedAt: z.number(),
});
export type AgentAccount = z.infer<typeof agentAccountSchema>;

export const rateLimitWindowSchema = z.object({
  resetsAt: z.number().optional(),
  usedPercent: z.number(),
  windowMinutes: z.number().optional(),
});
export type RateLimitWindow = z.infer<typeof rateLimitWindowSchema>;

export const accountUsageSchema = z.object({
  accountId: z.string().min(1),
  error: z.string().min(1).optional(),
  fetchedAt: z.number(),
  session: rateLimitWindowSchema.optional(),
  status: z.enum(["ok", "error"]),
  weekly: rateLimitWindowSchema.optional(),
});
export type AccountUsage = z.infer<typeof accountUsageSchema>;

export const agentAccountsSnapshotSchema = z.object({
  accounts: z.array(agentAccountSchema),
  activeAccountId: z.string().min(1).nullable(),
  lastLoginError: z
    .object({ at: z.number(), message: z.string().min(1) })
    .nullable(),
  loginPending: agentAccountProviderSchema.nullable(),
  ts: z.number(),
  usage: z.record(z.string().min(1), accountUsageSchema),
});
export type AgentAccountsSnapshot = z.infer<typeof agentAccountsSnapshotSchema>;
