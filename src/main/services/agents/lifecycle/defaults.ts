import { platform } from "node:os";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { PlannedPlan } from "./plan/types.ts";
import {
  buildGuideCommands,
  buildInstallPlan,
  buildUpdatePlan,
} from "./plan.ts";
import { getAgentLifecycleSpec } from "./specs/index.ts";

function hostKind(): "posix" | "win" {
  return platform() === "win32" ? "win" : "posix";
}

/** Optional human-readable install lines for details panel (not a separate CTA). */
export function guideCommandsFor(agentId: AgentKind) {
  const spec = getAgentLifecycleSpec(agentId);
  if (spec.support !== "full" || spec.install.length === 0) {
    return;
  }
  const fromPlan = buildGuideCommands(spec);
  return fromPlan.length > 0 ? fromPlan : undefined;
}

/** Shell line for UI placeholder / default override (`plan.preview` is UI-safe). */
function primaryPlanCommand(plan: PlannedPlan | null): string | null {
  if (!plan || plan.steps.length === 0) {
    return null;
  }
  const preview = plan.preview.trim();
  return preview.length > 0 ? preview : null;
}

export function defaultCommandsFor(
  agentId: AgentKind,
  installSource?: string | null,
  defaultBinPath?: string | null
): {
  defaultInstallCommand: string | null;
  defaultUpdateCommand: string | null;
} {
  const spec = getAgentLifecycleSpec(agentId);
  if (spec.support !== "full") {
    return { defaultInstallCommand: null, defaultUpdateCommand: null };
  }
  const host = hostKind();
  // Match install/update defaults to detected install source when known.
  const installPlan = buildInstallPlan(spec, host, {
    ...(installSource ? { installSource } : {}),
  });
  const updatePlan = buildUpdatePlan(spec, {
    host,
    ...(installSource ? { installSource } : {}),
    ...(defaultBinPath ? { defaultBinPath } : {}),
  });
  return {
    defaultInstallCommand: primaryPlanCommand(installPlan),
    defaultUpdateCommand: primaryPlanCommand(updatePlan),
  };
}
