/**
 * Dedicated uninstall run path. Never shares install/update post-success logic
 * (afterInstall, not_found_after_install, version-stuck multi-channel loop).
 */

import type {
  AgentInstallInfo,
  AgentLifecycleActionResult,
  AgentLifecycleErrorCode,
  AgentLifecycleProbe,
  AgentLifecycleProgress,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { PlannedPlan } from "./plan/types.ts";
import { planLifecycle } from "./plan.ts";
import {
  applyLifecycleCommandOverride,
  emptyLifecycleCommandOverrides,
  type LifecycleCommandOverrides,
} from "./resolve-commands.ts";
import type { LifecycleRunner } from "./runner/types.ts";
import { getAgentLifecycleSpec } from "./specs/index.ts";
import { wslDistroFromPath } from "./wsl.ts";

export interface RunUninstallUnlockedContext {
  afterUninstall?: (agentId: AgentKind) => Promise<void>;
  agentId: AgentKind;
  getLifecycleCommands?: () =>
    | LifecycleCommandOverrides
    | Promise<LifecycleCommandOverrides>;
  onProgress?: (progress: AgentLifecycleProgress) => void;
  probeOne: (
    agentId: AgentKind,
    env: NodeJS.ProcessEnv | null,
    opts: { deep: boolean; checkLatest: boolean; envDegraded: boolean }
  ) => Promise<AgentLifecycleProbe>;
  refreshDetection?: () => Promise<void>;
  resolveEnv: () => Promise<NodeJS.ProcessEnv>;
  runId: string;
  runner: LifecycleRunner;
  signal: AbortSignal;
}

function fail(
  agentId: AgentKind,
  errorCode: AgentLifecycleErrorCode,
  extras: Partial<AgentLifecycleActionResult> = {}
): AgentLifecycleActionResult {
  return {
    action: "uninstall",
    agentId,
    ok: false,
    errorCode,
    ...extras,
  };
}

/** Remaining installs for still_detected alert body (one line per copy). */
export function formatRemainingInstalls(
  installs: readonly AgentInstallInfo[]
): string {
  return installs
    .map((i) => {
      const ver = i.version ? ` (${i.version})` : "";
      return `[${i.source}] ${i.path}${ver}`;
    })
    .join("\n");
}

export async function runUninstallUnlocked(
  ctx: RunUninstallUnlockedContext
): Promise<AgentLifecycleActionResult> {
  const { agentId, runId, signal, runner } = ctx;
  const action = "uninstall" as const;
  const spec = getAgentLifecycleSpec(agentId);

  if (spec.support !== "full") {
    return fail(agentId, "unsupported", { runId });
  }

  if (signal.aborted) {
    return fail(agentId, "cancelled", { runId });
  }

  let env: NodeJS.ProcessEnv;
  try {
    env = await ctx.resolveEnv();
  } catch {
    return fail(agentId, "env_unavailable", { runId });
  }

  if (signal.aborted) {
    return fail(agentId, "cancelled", { runId });
  }

  const before = await ctx.probeOne(agentId, env, {
    deep: true,
    checkLatest: false,
    envDegraded: false,
  });

  if (signal.aborted) {
    return fail(agentId, "cancelled", { runId });
  }

  // Idempotent: already gone.
  if (!before.detected) {
    return {
      action,
      agentId,
      ok: true,
      skipped: true,
      version: before.version,
      runId,
    };
  }

  const defaultInstall =
    before.installs.find((i) => i.isPathDefault) ?? before.installs[0];
  const defaultPath = defaultInstall?.path ?? null;
  const installSource = defaultInstall?.source ?? null;
  const wslDistro = defaultPath ? wslDistroFromPath(defaultPath) : null;

  let planned: PlannedPlan | null = planLifecycle(spec, action, {
    defaultBinPath: defaultPath,
    wslDistro,
    ...(installSource ? { installSource } : {}),
  });

  // L2 custom shell replaces plan even when managed canUninstall is false.
  try {
    const cmds = ctx.getLifecycleCommands
      ? await ctx.getLifecycleCommands()
      : emptyLifecycleCommandOverrides();
    planned = applyLifecycleCommandOverride(action, agentId, planned, {
      install: cmds.install ?? {},
      update: cmds.update ?? {},
      uninstall: cmds.uninstall ?? {},
    });
  } catch (err) {
    console.warn("[agent-lifecycle] getLifecycleCommands failed", err);
  }

  if (!planned) {
    return fail(agentId, "no_command", { runId });
  }

  if (signal.aborted) {
    return fail(agentId, "cancelled", { runId });
  }

  // Single-shot plan: no version-stuck multi-channel loop.
  const result = await runner.run(planned, {
    env,
    signal,
    onProgress: (step) => {
      ctx.onProgress?.({
        action,
        agentId,
        runId,
        stepIndex: step.stepIndex,
        stepCount: planned.steps.length,
        label: step.label,
        ...(step.percent === undefined ? {} : { percent: step.percent }),
      });
    },
  });

  if (result.cancelled || signal.aborted) {
    return fail(agentId, "cancelled", {
      runId,
      commandPreview: planned.preview,
    });
  }
  if (result.timedOut) {
    return fail(agentId, "timeout", {
      runId,
      commandPreview: planned.preview,
    });
  }
  if (result.packageManagerMissing) {
    return fail(agentId, "package_manager_missing", {
      runId,
      commandPreview: planned.preview,
      errorDetail: result.stderr || undefined,
    });
  }
  if (!result.ok) {
    const detail = result.stderr?.trim() || planned.preview || undefined;
    return fail(agentId, "command_failed", {
      runId,
      commandPreview: planned.preview,
      errorDetail: detail,
    });
  }

  const after = await ctx.probeOne(agentId, env, {
    deep: true,
    checkLatest: false,
    envDegraded: false,
  });

  // Success contract: agent must be gone. Remaining copies → hard fail.
  if (after.detected) {
    return fail(agentId, "still_detected", {
      runId,
      commandPreview: planned.preview,
      errorDetail: formatRemainingInstalls(after.installs),
    });
  }

  try {
    await ctx.refreshDetection?.();
  } catch (err) {
    console.warn("[agent-lifecycle] refreshDetection failed", err);
  }
  try {
    await ctx.afterUninstall?.(agentId);
  } catch (err) {
    console.warn("[agent-lifecycle] afterUninstall failed", err);
  }

  return {
    action,
    agentId,
    ok: true,
    version: after.version,
    commandPreview: planned.preview,
    runId,
  };
}
