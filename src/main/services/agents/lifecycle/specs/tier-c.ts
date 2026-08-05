import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentLifecycleSpec } from "./types.ts";

/**
 * Website-only: no verified public install package/script Pier can lock safely.
 * (Placeholder npm names, wrong packages, or enterprise suite without a single CLI install URL.)
 */
function websiteOnly(
  agentId: AgentKind,
  expectedBins: readonly string[]
): AgentLifecycleSpec {
  return {
    agentId,
    expectedBins,
    support: "guided",
    install: [],
    update: [],
  };
}

export const TIER_C_SPECS: readonly AgentLifecycleSpec[] = [
  // Atlassian ACLI + org entitlement — multi-step OS installers, not a coding-agent npm
  websiteOnly("rovo", ["acli"]),
  // npm reserved / empty placeholders — not real products on registry
  websiteOnly("openclaude", ["openclaude"]),
  websiteOnly("ante", ["ante"]),
];
