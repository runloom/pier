import { type AgentKind, agentKindSchema } from "@shared/contracts/agent.ts";
import { TIER_A_SPECS } from "./tier-a.ts";
import { TIER_B_SPECS } from "./tier-b.ts";
import { TIER_C_SPECS } from "./tier-c.ts";
import type { AgentLifecycleSpec, AgentLifecycleSpecMap } from "./types.ts";

const ALL_SPECS: readonly AgentLifecycleSpec[] = [
  ...TIER_A_SPECS,
  ...TIER_B_SPECS,
  ...TIER_C_SPECS,
];

function buildMap(): AgentLifecycleSpecMap {
  const map = {} as Record<AgentKind, AgentLifecycleSpec>;
  for (const spec of ALL_SPECS) {
    if (map[spec.agentId]) {
      throw new Error(`Duplicate agent lifecycle spec for ${spec.agentId}`);
    }
    map[spec.agentId] = spec;
  }
  for (const id of agentKindSchema.options) {
    if (!map[id]) {
      map[id] = {
        agentId: id,
        expectedBins: [id],
        support: "none",
        install: [],
        update: [],
      };
    }
  }
  return map as AgentLifecycleSpecMap;
}

export const AGENT_LIFECYCLE_SPECS: AgentLifecycleSpecMap = buildMap();

export function getAgentLifecycleSpec(agentId: AgentKind): AgentLifecycleSpec {
  return AGENT_LIFECYCLE_SPECS[agentId];
}

export function listAgentLifecycleSpecs(): readonly AgentLifecycleSpec[] {
  return agentKindSchema.options.map((id) => AGENT_LIFECYCLE_SPECS[id]);
}

export type {
  AgentLifecycleSpec,
  InstallChannel,
  UpdateChannel,
} from "./types.ts";
