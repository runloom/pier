import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { AGENT_LIFECYCLE_BATCH_CONCURRENCY } from "@shared/agent-lifecycle/batch.ts";
import { mapPool } from "@shared/agent-lifecycle/map-pool.ts";
import type {
  AgentLifecycleAction,
  AgentLifecycleActionResult,
  AgentLifecycleErrorCode,
  AgentLifecycleProbe,
  AgentLifecycleProbeRequest,
  AgentLifecycleProgress,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { BusyError, LifecycleLocks } from "./locks.ts";
import type { PlannedPlan } from "./plan/types.ts";
import { planLifecycle, previewPlan } from "./plan.ts";
import { probeAgents, probeOneAgent } from "./probe.ts";
import {
  applyLifecycleCommandOverride,
  emptyLifecycleCommandOverrides,
  type LifecycleCommandOverrides,
} from "./resolve-commands.ts";
import { runUninstallUnlocked } from "./run-uninstall.ts";
import { createNodeLifecycleRunner } from "./runner/node.ts";
import type { LifecycleRunner, LifecycleRunResult } from "./runner/types.ts";
import { getAgentLifecycleSpec } from "./specs/index.ts";
import { wslDistroFromPath } from "./wsl.ts";

export type { LifecycleCommandOverrides } from "./resolve-commands.ts";

export interface AgentLifecycleService {
  /** Abort in-flight run for this agent (usable mid-run). */
  cancel(agentId: AgentKind): boolean;
  /** @deprecated Prefer cancel(agentId). Kept for runId-based cancel. */
  cancelRun(runId: string): boolean;
  probe(request?: AgentLifecycleProbeRequest): Promise<AgentLifecycleProbe[]>;
  run(
    agentId: AgentKind,
    action: AgentLifecycleAction
  ): Promise<AgentLifecycleActionResult>;
  runMany(
    agentIds: readonly AgentKind[],
    action: AgentLifecycleAction
  ): Promise<AgentLifecycleActionResult[]>;
}

export interface CreateAgentLifecycleServiceOptions {
  afterInstall?: (agentId: AgentKind) => Promise<void>;
  /** Best-effort hook cleanup + preference hygiene after successful uninstall. */
  afterUninstall?: (agentId: AgentKind) => Promise<void>;
  /** Required in product; tests inject. No silent process.env for run. */
  getEnv: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
  /** User-authored install/update/uninstall shell one-liners (empty = Pier default). */
  getLifecycleCommands?: () =>
    | LifecycleCommandOverrides
    | Promise<LifecycleCommandOverrides>;
  /** Live install/update progress (wired to window broadcast in product). */
  onProgress?: (progress: AgentLifecycleProgress) => void;
  /**
   * Refresh detection cache after success. Renderer should not also refresh
   * detect when this is wired — only re-probe lifecycle.
   */
  refreshDetection?: () => Promise<void>;
  runner?: LifecycleRunner;
  waitForHostEnv?: () => Promise<void>;
}

function fail(
  agentId: AgentKind,
  action: AgentLifecycleAction,
  errorCode: AgentLifecycleErrorCode,
  extras: Partial<AgentLifecycleActionResult> = {}
): AgentLifecycleActionResult {
  return {
    action,
    agentId,
    ok: false,
    errorCode,
    ...extras,
  };
}

function hostKind(): "posix" | "win" {
  return platform() === "win32" ? "win" : "posix";
}

/** Bare package-manager bins in planned argv steps (not self CLI paths). */
const PACKAGE_MANAGER_STEP_FILES = new Set(["npm", "brew", "pipx", "uv"]);

export function createAgentLifecycleService(
  options: CreateAgentLifecycleServiceOptions
): AgentLifecycleService {
  const waitForHostEnv = options.waitForHostEnv ?? (async () => undefined);
  const runner = options.runner ?? createNodeLifecycleRunner();
  const locks = new LifecycleLocks();
  /** agentId → abort controller for mid-run cancel */
  const abortByAgent = new Map<AgentKind, AbortController>();
  const runIdByAgent = new Map<AgentKind, string>();
  const agentByRunId = new Map<string, AgentKind>();

  async function resolveEnv(): Promise<NodeJS.ProcessEnv> {
    try {
      await waitForHostEnv();
      return await options.getEnv();
    } catch (err) {
      throw new EnvUnavailableError(
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async function probeOne(
    agentId: AgentKind,
    env: NodeJS.ProcessEnv | null,
    opts: { deep: boolean; checkLatest: boolean; envDegraded: boolean }
  ): Promise<AgentLifecycleProbe> {
    return probeOneAgent(agentId, env, { ...opts, host: hostKind() });
  }

  async function probe(
    request: AgentLifecycleProbeRequest = {}
  ): Promise<AgentLifecycleProbe[]> {
    return probeAgents(request, {
      resolveEnv,
      host: hostKind(),
    });
  }

  function cancel(agentId: AgentKind): boolean {
    const controller = abortByAgent.get(agentId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  function cancelRun(runId: string): boolean {
    const agentId = agentByRunId.get(runId);
    if (!agentId) {
      return false;
    }
    return cancel(agentId);
  }

  async function runUnlocked(
    agentId: AgentKind,
    action: AgentLifecycleAction,
    runId: string,
    signal: AbortSignal
  ): Promise<AgentLifecycleActionResult> {
    // Uninstall must never enter install/update post-success paths.
    if (action === "uninstall") {
      return runUninstallUnlocked({
        agentId,
        runId,
        signal,
        runner,
        resolveEnv,
        probeOne,
        ...(options.getLifecycleCommands
          ? { getLifecycleCommands: options.getLifecycleCommands }
          : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.refreshDetection
          ? { refreshDetection: options.refreshDetection }
          : {}),
        ...(options.afterUninstall
          ? { afterUninstall: options.afterUninstall }
          : {}),
      });
    }

    const spec = getAgentLifecycleSpec(agentId);
    if (spec.support !== "full") {
      return fail(agentId, action, "unsupported", { runId });
    }

    if (signal.aborted) {
      return fail(agentId, action, "cancelled", { runId });
    }

    let env: NodeJS.ProcessEnv;
    try {
      env = await resolveEnv();
    } catch {
      return fail(agentId, action, "env_unavailable", { runId });
    }

    if (signal.aborted) {
      return fail(agentId, action, "cancelled", { runId });
    }

    const before = await probeOne(agentId, env, {
      deep: true,
      checkLatest: false,
      envDegraded: false,
    });

    if (signal.aborted) {
      return fail(agentId, action, "cancelled", { runId });
    }

    if (action === "install" && !before.canInstall) {
      return fail(agentId, action, "no_command", { runId });
    }

    if (action === "install" && before.detected && !before.installedButBroken) {
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

    let planned = planLifecycle(spec, action, {
      defaultBinPath: defaultPath,
      wslDistro,
      // Source-aware install/update: match detected install channel when known.
      ...(installSource ? { installSource } : {}),
    });

    // User shell overrides (settings) replace the structured plan when non-empty.
    try {
      const cmds = options.getLifecycleCommands
        ? await options.getLifecycleCommands()
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
      return fail(agentId, action, "no_command", { runId });
    }

    if (signal.aborted) {
      return fail(agentId, action, "cancelled", { runId });
    }

    // Runner stops at first exit 0. Self-upgrades (e.g. `opencode upgrade`)
    // often exit 0 with "already installed" without bumping version — continue
    // remaining fallbacks so npm/brew/reinstall can still apply.
    const fullStepCount = planned.steps.length;
    let stepOffset = 0;
    let activePlan: PlannedPlan = planned;
    let after = before;

    for (;;) {
      const result: LifecycleRunResult = await runner.run(activePlan, {
        env,
        signal,
        onProgress: (step) => {
          options.onProgress?.({
            action,
            agentId,
            runId,
            stepIndex: stepOffset + step.stepIndex,
            stepCount: fullStepCount,
            label: step.label,
            ...(step.percent === undefined ? {} : { percent: step.percent }),
          });
        },
      });
      if (result.cancelled || signal.aborted) {
        return fail(agentId, action, "cancelled", {
          runId,
          commandPreview: planned.preview,
        });
      }
      if (result.timedOut) {
        return fail(agentId, action, "timeout", {
          runId,
          commandPreview: planned.preview,
          errorDetail: result.stderr || undefined,
        });
      }
      if (result.packageManagerMissing) {
        return fail(agentId, action, "package_manager_missing", {
          runId,
          commandPreview: planned.preview,
          errorDetail: result.stderr || undefined,
        });
      }
      if (!result.ok) {
        const detail = result.stderr?.trim() || planned.preview || undefined;
        return fail(agentId, action, "command_failed", {
          runId,
          commandPreview: planned.preview,
          errorDetail: detail,
        });
      }

      after = await probeOne(agentId, env, {
        deep: true,
        checkLatest: false,
        envDegraded: false,
      });

      // Version unchanged after a step: versioned-mode soft "already latest".
      // Reinstall-mode must NOT continue past a successful self-update (kiro/
      // hermes already-latest would otherwise fall into the official script).
      // Cursor auth exit-0 is handled by runner isSoftSuccessFailure instead.
      const versionStuck =
        action === "update" &&
        before.updateMode === "versioned" &&
        Boolean(before.version) &&
        Boolean(after.version) &&
        before.version === after.version;
      const absoluteStep = stepOffset + result.stepIndex;
      const hasMore = absoluteStep < fullStepCount - 1;
      // Only self-upgrade no-ops continue (exit 0, version same). Package-manager
      // success with unchanged version means that channel is already current —
      // do not fall through to a different PM (would dual-install).
      const succeeded = activePlan.steps[result.stepIndex];
      const selfNoop =
        versionStuck &&
        succeeded?.kind === "argv" &&
        !PACKAGE_MANAGER_STEP_FILES.has(succeeded.file);
      if (selfNoop && hasMore) {
        stepOffset = absoluteStep + 1;
        const remaining = planned.steps.slice(stepOffset);
        activePlan = {
          steps: remaining,
          preview: previewPlan(remaining),
        };
        continue;
      }

      if (versionStuck) {
        return fail(agentId, action, "version_unchanged", {
          runId,
          softFailure: "version_unchanged",
          version: after.version,
          commandPreview: planned.preview,
        });
      }

      break;
    }

    if (after.installedButBroken) {
      return fail(agentId, action, "not_runnable", {
        runId,
        softFailure: "not_runnable",
        version: after.version,
        commandPreview: planned.preview,
      });
    }

    if (!after.detected) {
      return fail(agentId, action, "not_found_after_install", {
        runId,
        version: after.version,
        commandPreview: planned.preview,
      });
    }

    try {
      await options.refreshDetection?.();
    } catch (err) {
      console.warn("[agent-lifecycle] refreshDetection failed", err);
    }
    try {
      await options.afterInstall?.(agentId);
    } catch (err) {
      console.warn("[agent-lifecycle] afterInstall failed", err);
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

  async function run(
    agentId: AgentKind,
    action: AgentLifecycleAction
  ): Promise<AgentLifecycleActionResult> {
    const runId = randomUUID();
    const controller = new AbortController();

    try {
      return await locks.withAgentLock(
        agentId,
        async () => {
          try {
            return await runUnlocked(agentId, action, runId, controller.signal);
          } finally {
            abortByAgent.delete(agentId);
            runIdByAgent.delete(agentId);
            agentByRunId.delete(runId);
          }
        },
        () => {
          // Sync claim: cancel(agentId) works as soon as the agent is reserved.
          abortByAgent.set(agentId, controller);
          runIdByAgent.set(agentId, runId);
          agentByRunId.set(runId, agentId);
        }
      );
    } catch (err) {
      if (err instanceof BusyError) {
        return fail(agentId, action, "busy");
      }
      throw err;
    }
  }

  async function runMany(
    agentIds: readonly AgentKind[],
    action: AgentLifecycleAction
  ): Promise<AgentLifecycleActionResult[]> {
    // Bounded parallel: different agents install at once; same agent still busy-locked.
    return mapPool(agentIds, AGENT_LIFECYCLE_BATCH_CONCURRENCY, (id) =>
      run(id, action)
    );
  }

  return { probe, run, runMany, cancel, cancelRun };
}

class EnvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvUnavailableError";
  }
}
