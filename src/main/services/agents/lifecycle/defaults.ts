import { platform } from "node:os";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { PlannedPlan } from "./plan/types.ts";
import {
  buildGuideCommands,
  buildInstallPlan,
  buildUninstallPlan,
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
  defaultUninstallCommand: string | null;
  defaultUpdateCommand: string | null;
} {
  const empty = {
    defaultInstallCommand: null,
    defaultUninstallCommand: null,
    defaultUpdateCommand: null,
  } as const;
  const spec = getAgentLifecycleSpec(agentId);
  if (spec.support !== "full") {
    return { ...empty };
  }
  const host = hostKind();
  // Match install/update/uninstall defaults to detected install source when known.
  const sourceOpts = installSource ? { installSource } : {};
  const binOpts = defaultBinPath ? { defaultBinPath } : {};
  const installPlan = buildInstallPlan(spec, host, sourceOpts);
  const updatePlan = buildUpdatePlan(spec, {
    host,
    ...sourceOpts,
    ...binOpts,
  });
  const uninstallPlan = buildUninstallPlan(spec, {
    host,
    ...sourceOpts,
    ...binOpts,
  });
  return {
    defaultInstallCommand: primaryPlanCommand(installPlan),
    defaultUninstallCommand: primaryPlanCommand(uninstallPlan),
    defaultUpdateCommand: primaryPlanCommand(updatePlan),
  };
}
