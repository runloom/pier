import type { AgentKind } from "../contracts/agent.ts";

/**
 * Website-only / no Pier-managed install plan. Must stay in lockstep with
 * lifecycle specs (`support !== "full"`).
 */
export const AGENT_NO_ONE_CLICK_INSTALL = [
  "ante",
  "openclaude",
  "rovo",
] as const satisfies readonly AgentKind[];

const NO_ONE_CLICK = new Set<AgentKind>(AGENT_NO_ONE_CLICK_INSTALL);

/** True when Settings can offer one-click install without waiting for probe. */
export function agentOffersOneClickInstall(agentId: AgentKind): boolean {
  return !NO_ONE_CLICK.has(agentId);
}
