/**
 * User override resolution for lifecycle plans.
 *
 * Product rule: only **update** accepts a user shell override (settings InputRow).
 * Install and uninstall always use project specs (L1) — prefs keys may still exist
 * for backward compatibility but are ignored at run time.
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
  if (action !== "update") {
    return planned;
  }
  const custom = cmds.update[agentId]?.trim();
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
