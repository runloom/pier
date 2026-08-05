import { AGENT_LIFECYCLE_BATCH_CONCURRENCY } from "@shared/agent-lifecycle/batch.ts";
import { mapPool } from "@shared/agent-lifecycle/map-pool.ts";
import type {
  AgentLifecycleAction,
  AgentLifecycleActionResult,
  AgentLifecycleProbe,
  AgentLifecycleProgress,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { create } from "zustand";
import type { AgentLifecycleFailure } from "@/pages/settings/components/agent-lifecycle-format.ts";
import { isLifecycleSoftFailure } from "@/pages/settings/components/agent-lifecycle-format.ts";
import { useAgentDetectStore } from "./agent-detect.store.ts";
import { useAgentPreferencesStore } from "./agent-preferences.store.ts";

const PROBE_TTL_MS = 10 * 60 * 1000;

/** Explicit per-agent job — no cross-product of batchIds × actionById. */
export type LifecycleJobPhase = "queued" | "running";

export interface LifecycleJob {
  readonly action: AgentLifecycleAction;
  readonly phase: LifecycleJobPhase;
  readonly progress?: AgentLifecycleProgress;
}

interface AgentLifecycleState {
  cancel: (agentId: AgentKind) => Promise<boolean>;
  clearFailure: (agentId: AgentKind) => void;
  clearJob: (agentId: AgentKind) => void;
  failureById: Partial<Record<AgentKind, AgentLifecycleFailure>>;
  getJob: (agentId: AgentKind) => LifecycleJob | undefined;
  getProbe: (agentId: AgentKind) => AgentLifecycleProbe | undefined;
  isProbing: boolean;
  /** agentId → active install/update job (queued or running). */
  jobById: Partial<Record<AgentKind, LifecycleJob>>;
  lastProbeAt: number | null;
  probe: (
    agentIds?: readonly AgentKind[],
    options?: { force?: boolean; checkLatest?: boolean }
  ) => Promise<void>;
  probesById: Partial<Record<AgentKind, AgentLifecycleProbe>>;
  run: (
    agentId: AgentKind,
    action: AgentLifecycleAction
  ) => Promise<AgentLifecycleActionResult>;
  runMany: (
    agentIds: readonly AgentKind[],
    action: AgentLifecycleAction
  ) => Promise<AgentLifecycleActionResult[]>;
  /** Ensure main→renderer progress subscription is active (idempotent). */
  startProgressSubscription: () => void;
  updatableIds: () => AgentKind[];
}

function mergeProbes(
  prev: Partial<Record<AgentKind, AgentLifecycleProbe>>,
  next: AgentLifecycleProbe[]
): Partial<Record<AgentKind, AgentLifecycleProbe>> {
  const out = { ...prev };
  for (const probe of next) {
    const previous = out[probe.agentId];
    if (
      previous?.latestVersion &&
      (probe.latestVersion === null || probe.latestVersion === undefined)
    ) {
      out[probe.agentId] = {
        ...probe,
        latestVersion: previous.latestVersion,
        updateAvailable: previous.updateAvailable,
        updateOffered: previous.updateOffered || probe.updateOffered,
      };
      continue;
    }
    out[probe.agentId] = probe;
  }
  return out;
}

/**
 * Probe says an update is available (may still be hidden in UI when disabled).
 * Pass `disabled: true` for Update-button / "Update all" eligibility.
 */
export function isLifecycleUpdateCandidate(
  probe: AgentLifecycleProbe | undefined,
  options?: { disabled?: boolean }
): boolean {
  if (options?.disabled === true) {
    return false;
  }
  return (
    probe !== undefined &&
    probe.support === "full" &&
    probe.canInstall &&
    probe.updateOffered
  );
}

function failureFromResult(
  result: AgentLifecycleActionResult,
  stepLabel?: string
): AgentLifecycleFailure | null {
  if (result.ok || result.skipped || isLifecycleSoftFailure(result)) {
    return null;
  }
  return {
    action: result.action,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.errorDetail ? { errorDetail: result.errorDetail } : {}),
    ...(stepLabel ? { stepLabel } : {}),
  };
}

async function syncDetectFromMain(): Promise<void> {
  try {
    await useAgentDetectStore.getState().refresh();
  } catch {
    // best-effort
  }
}

let progressUnsub: (() => void) | null = null;

export const useAgentLifecycleStore = create<AgentLifecycleState>(
  (set, get) => ({
    failureById: {},
    isProbing: false,
    jobById: {},
    lastProbeAt: null,
    probesById: {},

    clearJob(agentId) {
      set((state) => {
        if (!state.jobById[agentId]) {
          return state;
        }
        const next = { ...state.jobById };
        delete next[agentId];
        return { jobById: next };
      });
    },

    clearFailure(agentId) {
      set((state) => {
        if (!state.failureById[agentId]) {
          return state;
        }
        const next = { ...state.failureById };
        delete next[agentId];
        return { failureById: next };
      });
    },

    getJob(agentId) {
      return get().jobById[agentId];
    },

    getProbe(agentId) {
      return get().probesById[agentId];
    },

    startProgressSubscription() {
      if (progressUnsub) {
        return;
      }
      const api = window.pier?.agents?.lifecycle;
      if (!api?.onProgress) {
        return;
      }
      progressUnsub = api.onProgress((progress) => {
        set((state) => {
          const existing = state.jobById[progress.agentId];
          if (!existing) {
            // Progress for a job we are not tracking (e.g. other window).
            return state;
          }
          return {
            jobById: {
              ...state.jobById,
              [progress.agentId]: {
                action: existing.action,
                phase: "running",
                progress,
              },
            },
          };
        });
      });
    },

    async cancel(agentId) {
      const api = window.pier?.agents?.lifecycle;
      if (!api?.cancel) {
        return false;
      }
      return api.cancel(agentId);
    },

    async probe(agentIds, options) {
      const force = options?.force === true;
      const checkLatest = options?.checkLatest === true;
      const last = get().lastProbeAt;
      if (
        !(force || checkLatest) &&
        last !== null &&
        Date.now() - last < PROBE_TTL_MS &&
        !agentIds
      ) {
        return;
      }
      const api = window.pier?.agents?.lifecycle;
      if (!api) {
        return;
      }
      set({ isProbing: true });
      try {
        const probes = await api.probe({
          ...(agentIds ? { agentIds: [...agentIds] } : {}),
          checkLatest,
        });
        set((state) => ({
          probesById: mergeProbes(state.probesById, probes),
          lastProbeAt: Date.now(),
        }));
      } finally {
        set({ isProbing: false });
      }
    },

    async run(agentId, action) {
      get().startProgressSubscription();
      const api = window.pier?.agents?.lifecycle;
      if (!api) {
        return {
          action,
          agentId,
          ok: false,
          errorCode: "unavailable",
        };
      }
      set((state) => {
        const nextFailures = { ...state.failureById };
        delete nextFailures[agentId];
        return {
          jobById: {
            ...state.jobById,
            [agentId]: { action, phase: "running" },
          },
          failureById: nextFailures,
        };
      });
      try {
        const result = await api.run(agentId, action);
        if (result.ok && !result.skipped) {
          await syncDetectFromMain();
        }
        const stepLabel = get().jobById[agentId]?.progress?.label;
        const failure = failureFromResult(result, stepLabel);
        set((state) => {
          const nextFailures = { ...state.failureById };
          if (failure) {
            nextFailures[agentId] = failure;
          } else {
            delete nextFailures[agentId];
          }
          return { failureById: nextFailures };
        });
        await get().probe([agentId], { force: true, checkLatest: true });
        return result;
      } finally {
        get().clearJob(agentId);
      }
    },

    async runMany(agentIds, action) {
      get().startProgressSubscription();
      const api = window.pier?.agents?.lifecycle;
      if (!api) {
        return agentIds.map((agentId) => ({
          action,
          agentId,
          ok: false,
          errorCode: "unavailable" as const,
        }));
      }
      const batchSnapshot = [...agentIds];
      // All start queued; workers promote to running when claimed.
      set((state) => {
        const nextFailures = { ...state.failureById };
        const nextJobs = { ...state.jobById };
        for (const id of batchSnapshot) {
          delete nextFailures[id];
          nextJobs[id] = { action, phase: "queued" };
        }
        return { failureById: nextFailures, jobById: nextJobs };
      });
      try {
        // UI owns batch membership (queued → running → gone). Main run()
        // still enforces per-agent locks; do not also call main runMany
        // (would double-pool).
        const results = await mapPool(
          batchSnapshot,
          AGENT_LIFECYCLE_BATCH_CONCURRENCY,
          async (agentId) => {
            set((state) => ({
              jobById: {
                ...state.jobById,
                [agentId]: {
                  action,
                  phase: "running",
                  progress: state.jobById[agentId]?.progress,
                },
              },
            }));
            try {
              const result = await api.run(agentId, action);
              const stepLabel = get().jobById[agentId]?.progress?.label;
              const failure = failureFromResult(result, stepLabel);
              set((state) => {
                const nextFailures = { ...state.failureById };
                if (failure) {
                  nextFailures[agentId] = failure;
                } else {
                  delete nextFailures[agentId];
                }
                return { failureById: nextFailures };
              });
              return result;
            } finally {
              get().clearJob(agentId);
            }
          }
        );
        if (results.some((r) => r.ok && !r.skipped)) {
          await syncDetectFromMain();
        }
        await get().probe(batchSnapshot, { force: true, checkLatest: true });
        return results;
      } finally {
        // Drop any stragglers if cancel/abort left jobs behind.
        set((state) => {
          const next = { ...state.jobById };
          for (const id of batchSnapshot) {
            delete next[id];
          }
          return { jobById: next };
        });
      }
    },

    updatableIds() {
      const disabled = new Set(
        useAgentPreferencesStore.getState().disabledAgentIds
      );
      const out: AgentKind[] = [];
      for (const probe of Object.values(get().probesById)) {
        if (
          probe &&
          isLifecycleUpdateCandidate(probe, {
            disabled: disabled.has(probe.agentId),
          })
        ) {
          out.push(probe.agentId);
        }
      }
      return out;
    },
  })
);
