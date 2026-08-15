import { AGENT_LIFECYCLE_BATCH_CONCURRENCY } from "@shared/agent-lifecycle/batch.ts";
import { mapPool } from "@shared/agent-lifecycle/map-pool.ts";
import type {
  AgentLifecycleAction,
  AgentLifecycleActionResult,
  AgentLifecycleProbe,
  AgentLifecycleProgress,
} from "@shared/contracts/agent/lifecycle.ts";
import { type AgentKind, agentKindSchema } from "@shared/contracts/agent.ts";
import type { CatalogDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { create } from "zustand";
import type { AgentLifecycleFailure } from "@/pages/settings/components/agent-lifecycle-format.ts";
import { isLifecycleSoftFailure } from "@/pages/settings/components/agent-lifecycle-format.ts";
import {
  hasCachedProbes,
  listLifecycleUpdateCandidates,
} from "./agent-lifecycle-probe.ts";
import { useAgentPreferencesStore } from "./agent-preferences.store.ts";
import { probesFromAgentSnapshot } from "./host-catalog/agent-mirror.ts";
import { useHostCatalogStore } from "./host-catalog/store.ts";

export {
  countLifecycleUpdateCandidates,
  isLifecycleReinstallCandidate,
  isLifecycleUpdateCandidate,
  listLifecycleUpdateCandidates,
  mergeProbes,
  withDerivedUpdateFlags,
} from "./agent-lifecycle-probe.ts";

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
  /** Last successful full-catalog probe that requested checkLatest. */
  lastCheckLatestAt: number | null;
  /** Last successful full-catalog local probe (any checkLatest). */
  lastProbeAt: number | null;
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
   * Settings-open: keep `probesById` and ask catalog.ensureFresh (no force).
   * Silent when a previous snapshot exists. Toolbar refresh uses detect.refresh.
   */
  softRevalidate: () => Promise<void>;
  /** Ensure main→renderer progress subscription is active (idempotent). */
  startProgressSubscription: () => void;
  updatableIds: () => AgentKind[];
}

/** Non-silent open-path depth so overlapping SWR does not clear spinner early. */
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

async function revalidateAgentCatalog(force: boolean): Promise<void> {
  await useHostCatalogStore.getState().ensureFresh({
    class: "all",
    domain: "agent-cli",
    ...(force ? { force: true } : {}),
  });
}

function applyLifecycleSnapshot(snapshot: CatalogDomainSnapshot): void {
  if (snapshot.domain !== "agent-cli") {
    return;
  }
  const shouldApply =
    snapshot.revision > 0 ||
    snapshot.localProbedAt !== null ||
    snapshot.remoteCheckedAt !== null ||
    snapshot.items.length > 0;
  if (!shouldApply) {
    return;
  }
  const incoming = probesFromAgentSnapshot(snapshot);
  const incomingById = new Map(incoming.map((probe) => [probe.agentId, probe]));
  const previous = useAgentLifecycleStore.getState().probesById;
  const next: Partial<Record<AgentKind, AgentLifecycleProbe>> = {};
  for (const item of snapshot.items) {
    const parsed = agentKindSchema.safeParse(item.id);
    if (!parsed.success) {
      continue;
    }
    if (item.presence !== "present" && item.presence !== "broken") {
      continue;
    }
    const id = parsed.data;
    const incomingProbe = incomingById.get(id);
    if (incomingProbe) {
      next[id] = incomingProbe;
    } else if (previous[id]) {
      next[id] = previous[id];
    }
  }
  useAgentLifecycleStore.setState({
    lastCheckLatestAt: snapshot.remoteCheckedAt,
    lastProbeAt: snapshot.localProbedAt,
    probesById: next,
  });
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

    softRevalidate() {
      const hasCache = hasCachedProbes(get().probesById);
      return (async () => {
        if (!hasCache) {
          probingBusyDepth += 1;
          if (probingBusyDepth === 1) {
            set({ isProbing: true });
          }
        }
        try {
          await revalidateAgentCatalog(false);
        } finally {
          if (!hasCache) {
            probingBusyDepth = Math.max(0, probingBusyDepth - 1);
            if (probingBusyDepth === 0) {
              set({ isProbing: false });
            }
          }
        }
      })();
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
        if (result.ok && !result.skipped) {
          await revalidateAgentCatalog(true);
        }
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
          await revalidateAgentCatalog(true);
        }
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
      return listLifecycleUpdateCandidates(
        get().probesById,
        useAgentPreferencesStore.getState().disabledAgentIds
      );
    },
  })
);

const initialAgentCli = useHostCatalogStore.getState().domains["agent-cli"];
if (initialAgentCli) {
  applyLifecycleSnapshot(initialAgentCli);
}
useHostCatalogStore.subscribe((state, previous) => {
  const next = state.domains["agent-cli"];
  if (next && next !== previous.domains["agent-cli"]) {
    applyLifecycleSnapshot(next);
  }
});
