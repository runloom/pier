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
import {
  hasCachedProbes,
  isLifecycleUpdateCandidate,
  isTargetedAgentIds,
  mergeProbes,
  shouldSkipFullCatalogProbe,
} from "./agent-lifecycle-probe.ts";
import { useAgentPreferencesStore } from "./agent-preferences.store.ts";

export {
  AGENT_LIFECYCLE_CHECK_LATEST_TTL_MS,
  AGENT_LIFECYCLE_PROBE_TTL_MS,
  isLifecycleUpdateCandidate,
  isTargetedAgentIds,
  mergeProbes,
  shouldSkipFullCatalogProbe,
  withDerivedUpdateFlags,
} from "./agent-lifecycle-probe.ts";

/** Explicit per-agent job — no cross-product of batchIds × actionById. */
export type LifecycleJobPhase = "queued" | "running";

export interface LifecycleJob {
  readonly action: AgentLifecycleAction;
  readonly phase: LifecycleJobPhase;
  readonly progress?: AgentLifecycleProgress;
}

export interface AgentLifecycleProbeOptions {
  /** Ask main for remote latest versions (npm/brew/…). */
  checkLatest?: boolean;
  /** Bypass TTL and always hit main (toolbar refresh / post install). */
  force?: boolean;
  /**
   * Do not flip `isProbing` (settings open SWR path with existing rows).
   * Failures stay silent; callers that need UI busy pass false/omit.
   */
  silent?: boolean;
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
  /** Last successful full-catalog probe that requested checkLatest. */
  lastCheckLatestAt: number | null;
  /** Last successful full-catalog local probe (any checkLatest). */
  lastProbeAt: number | null;
  probe: (
    agentIds?: readonly AgentKind[],
    options?: AgentLifecycleProbeOptions
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
  /**
   * Settings-open SWR: keep `probesById`, revalidate when TTL says stale.
   * Silent when a previous snapshot exists so the list never looks like a
   * full-page reload. Manual toolbar refresh must use force probe instead.
   */
  softRevalidate: () => Promise<void>;
  /** Ensure main→renderer progress subscription is active (idempotent). */
  startProgressSubscription: () => void;
  updatableIds: () => AgentKind[];
}

/** Join concurrent full-catalog probes (Strict Mode / remount / open+refresh). */
let fullCatalogProbeInFlight: Promise<void> | null = null;
/** Non-silent probe depth so overlapping busy probes do not clear spinner early. */
let probingBusyDepth = 0;

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
    lastCheckLatestAt: null,
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
      const silent = options?.silent === true;
      const targeted = isTargetedAgentIds(agentIds);
      const state = get();
      if (
        shouldSkipFullCatalogProbe({
          force,
          checkLatest,
          ...(agentIds === undefined ? {} : { agentIds }),
          lastProbeAt: state.lastProbeAt,
          lastCheckLatestAt: state.lastCheckLatestAt,
          probesById: state.probesById,
        })
      ) {
        return;
      }

      // Full-catalog: join an in-flight soft probe; force waits then re-runs.
      if (!targeted && fullCatalogProbeInFlight) {
        if (!force) {
          return fullCatalogProbeInFlight;
        }
        await fullCatalogProbeInFlight.catch(() => undefined);
        const after = get();
        if (
          shouldSkipFullCatalogProbe({
            force,
            checkLatest,
            ...(agentIds === undefined ? {} : { agentIds }),
            lastProbeAt: after.lastProbeAt,
            lastCheckLatestAt: after.lastCheckLatestAt,
            probesById: after.probesById,
          })
        ) {
          return;
        }
      }

      const run = async (): Promise<void> => {
        const api = window.pier?.agents?.lifecycle;
        if (!api?.probe) {
          return;
        }
        // Never clear probesById before merge — SWR keeps previous rows visible.
        if (!silent) {
          probingBusyDepth += 1;
          if (probingBusyDepth === 1) {
            set({ isProbing: true });
          }
        }
        try {
          const probes = await api.probe({
            ...(targeted && agentIds ? { agentIds: [...agentIds] } : {}),
            checkLatest,
          });
          const now = Date.now();
          set((prev) => ({
            probesById: mergeProbes(prev.probesById, probes),
            // Targeted re-probes refresh rows but do not extend full-catalog TTL.
            ...(targeted
              ? {}
              : {
                  lastProbeAt: now,
                  ...(checkLatest ? { lastCheckLatestAt: now } : {}),
                }),
          }));
        } finally {
          if (!silent) {
            probingBusyDepth = Math.max(0, probingBusyDepth - 1);
            if (probingBusyDepth === 0) {
              set({ isProbing: false });
            }
          }
        }
      };

      if (!targeted) {
        const p = run().finally(() => {
          if (fullCatalogProbeInFlight === p) {
            fullCatalogProbeInFlight = null;
          }
        });
        fullCatalogProbeInFlight = p;
        return p;
      }

      return run();
    },

    softRevalidate() {
      const hasCache = hasCachedProbes(get().probesById);
      // Open path: never force. With cache → silent background; first visit →
      // show toolbar busy while the initial snapshot loads.
      return get().probe(undefined, {
        checkLatest: true,
        silent: hasCache,
      });
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
