/**
 * agents.catalog / list / get 只读发现（T4）。
 */
import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import type { AgentRuntimeIndexSnapshot } from "@shared/contracts/agent/runtime-index.ts";

export interface AgentCatalogItem {
  agentId: string;
  /** T4：未接 detection 时为 unknown；后续可接 detection-service */
  availability: "unknown" | "available" | "unavailable";
  label: string;
  launchCmd?: string;
  reason?: string;
}

export interface AgentsDiscovery {
  listCatalog: () => AgentCatalogItem[];
  listRunning: () => AgentRuntimeIndexSnapshot;
}

export function createStaticAgentsDiscovery(
  listRunning: () => AgentRuntimeIndexSnapshot = () => ({
    entries: [],
    ts: Date.now(),
  })
): AgentsDiscovery {
  return {
    listCatalog: () =>
      AGENT_CATALOG.map((entry) => ({
        agentId: entry.id,
        label: entry.label,
        availability: "unknown" as const,
        launchCmd: entry.launchCmd,
        reason: "detection not wired in control v2 T4",
      })),
    listRunning,
  };
}

export function findRunningAgent(
  snapshot: AgentRuntimeIndexSnapshot,
  params: { agentRef?: string; agentId?: string; panelId?: string }
) {
  const { agentRef, agentId, panelId } = params;
  if (agentRef) {
    return snapshot.entries.find((e) => e.agentRef === agentRef) ?? null;
  }
  if (panelId) {
    return snapshot.entries.find((e) => e.panelId === panelId) ?? null;
  }
  if (agentId) {
    const matches = snapshot.entries.filter((e) => e.agentId === agentId);
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
    if (matches.length > 1) {
      return { ambiguous: true as const, matches };
    }
    return null;
  }
  return null;
}
