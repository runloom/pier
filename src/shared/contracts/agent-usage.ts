import { z } from "zod";
import { type AgentKind, agentKindSchema } from "./agent.ts";

export const agentUsageEntrySchema = z.object({
  agentId: agentKindSchema,
  lastUsedAt: z.number().int().nonnegative(),
  useCount: z.number().int().positive(),
});

export const agentUsageStateSchema = z.object({
  entries: z.array(agentUsageEntrySchema).max(agentKindSchema.options.length),
  version: z.literal(1),
});

export type AgentUsageEntry = z.infer<typeof agentUsageEntrySchema>;
export type AgentUsageState = z.infer<typeof agentUsageStateSchema>;

export const EMPTY_AGENT_USAGE_STATE: AgentUsageState = {
  entries: [],
  version: 1,
};

export interface AgentSelectionResult {
  detectedIds: AgentKind[];
  enabledIds: AgentKind[];
  rankedIds: AgentKind[];
  selectedId: AgentKind | null;
}
