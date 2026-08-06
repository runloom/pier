/**
 * Shared L2 command override resolution for install / update / uninstall.
 * Non-empty user shell one-liner replaces the entire planned plan.
 */

import type { AgentLifecycleAction } from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { PlannedPlan } from "./plan/types.ts";

export interface LifecycleCommandOverrides {
  install: Partial<Record<AgentKind, string>>;
  uninstall: Partial<Record<AgentKind, string>>;
  update: Partial<Record<AgentKind, string>>;
}

export function applyLifecycleCommandOverride(
  action: AgentLifecycleAction,
  agentId: AgentKind,
  planned: PlannedPlan | null,
  cmds: LifecycleCommandOverrides
): PlannedPlan | null {
  const custom = cmds[action][agentId]?.trim();
  if (custom && custom.length > 0) {
    return {
      steps: [{ kind: "shell", command: custom }],
      preview: custom,
    };
  }
  return planned;
}

export function emptyLifecycleCommandOverrides(): LifecycleCommandOverrides {
  return { install: {}, update: {}, uninstall: {} };
}
