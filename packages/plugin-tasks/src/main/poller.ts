import { isHeuristicLaneSet } from "../shared/columns.ts";
import {
  POLL_INTERVAL_MS,
  POLL_UNFOCUSED_INTERVAL_MS,
  SCHEMA_VERSION,
} from "../shared/constants.ts";
import { dagFromBoard } from "../shared/dag.ts";
import type {
  TaskBoardParams,
  TaskBoardSnapshot,
  TaskDagSnapshot,
} from "../shared/types.ts";
import type { BoardCache } from "./cache.ts";
import { applyOverlaysToBoard, type OverlayStore } from "./overlay.ts";
import type { TrackerProvider } from "./providers/types.ts";
import { boardParamsMatch, encodeScopeId } from "./scope-id.ts";

export interface BoardPoller {
  refreshBoard(
    params: TaskBoardParams,
    options?: { force?: boolean }
  ): Promise<TaskBoardSnapshot>;
  repaint(): Promise<void>;
  setFocused(focused: boolean): void;
  snapshotBoard(
    params: TaskBoardParams,
    options?: { force?: boolean }
  ): Promise<TaskBoardSnapshot>;
  snapshotDag(params: TaskBoardParams): Promise<TaskDagSnapshot>;
  unwatch(params: TaskBoardParams): Promise<void>;
  watch(params: TaskBoardParams): Promise<void>;
}

export function createBoardPoller(input: {
  cache: BoardCache;
  emitBoard: (snapshot: TaskBoardSnapshot) => void;
  emitDag: (snapshot: TaskDagSnapshot) => void;
  emitUnlocked?: (payload: {
    kind: "pr-merged" | "newly-ready";
    keys: readonly string[];
    params: TaskBoardParams;
  }) => void;
  logger: { warn(message: string, meta?: unknown): void };
  now?: () => number;
  overlays?: OverlayStore;
  provider: TrackerProvider;
}): BoardPoller {
  const now = input.now ?? Date.now;
  const leases = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const generations = new Map<string, number>();
  let focused = true;

  const intervalMs = () =>
    focused ? POLL_INTERVAL_MS : POLL_UNFOCUSED_INTERVAL_MS;

  const cachedBoardUsable = (
    cached: TaskBoardSnapshot | undefined,
    params: TaskBoardParams
  ): cached is TaskBoardSnapshot => {
    if (!cached) {
      return false;
    }
    if (cached.schemaVersion !== SCHEMA_VERSION) {
      return false;
    }
    if (!boardParamsMatch(cached.params, params)) {
      return false;
    }
    return !(
      (params.provider === "linear" || params.provider === "jira") &&
      isHeuristicLaneSet(cached.columns)
    );
  };

  const nextGeneration = (params: TaskBoardParams): number => {
    const id = encodeScopeId(params);
    const next = (generations.get(id) ?? 0) + 1;
    generations.set(id, next);
    return next;
  };

  const attach = async (
    snapshot: TaskBoardSnapshot
  ): Promise<TaskBoardSnapshot> => {
    if (!input.overlays) {
      return snapshot;
    }
    return applyOverlaysToBoard(snapshot, await input.overlays.list());
  };

  const pullBoard = async (
    params: TaskBoardParams
  ): Promise<TaskBoardSnapshot> => {
    const previous = input.cache.get(params);
    const fetched = await input.provider.fetchBoard(params);
    const snapshot = await attach({
      ...fetched,
      generation: nextGeneration(params),
    });
    await input.cache.set(params, snapshot);
    input.emitBoard(snapshot);
    // dag is a pure derivation; one tracker fetch feeds both projections.
    input.emitDag(dagFromBoard(snapshot));
    if (previous && input.emitUnlocked) {
      const unlocked = diffUnlocked(previous, snapshot);
      if (unlocked.kind && unlocked.keys.length > 0) {
        input.emitUnlocked({
          kind: unlocked.kind,
          keys: unlocked.keys,
          params,
        });
      }
    }
    return snapshot;
  };

  const ensureTimer = (params: TaskBoardParams) => {
    const id = encodeScopeId(params);
    const existing = timers.get(id);
    if (existing) {
      return;
    }
    const timer = setInterval(() => {
      pullBoard(params).catch((error: unknown) => {
        input.logger.warn("[pier.tasks] board poll failed", error);
      });
    }, intervalMs());
    timers.set(id, timer);
  };

  const paramsById = new Map<string, TaskBoardParams>();

  const restart = () => {
    for (const timer of timers.values()) {
      clearInterval(timer);
    }
    timers.clear();
    for (const [id, count] of leases.entries()) {
      if (count <= 0) {
        continue;
      }
      const params = paramsById.get(id);
      if (params) {
        ensureTimer(params);
      }
    }
  };

  return {
    async refreshBoard(params, options) {
      if (!options?.force) {
        const cached = input.cache.get(params);
        if (
          cachedBoardUsable(cached, params) &&
          now() - cached.fetchedAt < intervalMs()
        ) {
          return await attach(cached);
        }
      }
      return await pullBoard(params);
    },
    async repaint() {
      for (const params of paramsById.values()) {
        const cached = input.cache.get(params);
        if (cached) {
          input.emitBoard(await attach(cached));
        }
      }
    },
    async snapshotBoard(params, options) {
      await input.cache.init();
      if (!options?.force) {
        const cached = input.cache.get(params);
        if (cachedBoardUsable(cached, params)) {
          return await attach(cached);
        }
      }
      return await pullBoard(params);
    },
    async snapshotDag(params) {
      await input.cache.init();
      const cached = input.cache.get(params);
      const board = cachedBoardUsable(cached, params)
        ? await attach(cached)
        : await pullBoard(params);
      return dagFromBoard(board);
    },
    setFocused(nextFocused) {
      if (focused === nextFocused) {
        return;
      }
      focused = nextFocused;
      restart();
    },
    async watch(params) {
      const id = encodeScopeId(params);
      paramsById.set(id, params);
      const previous = leases.get(id) ?? 0;
      leases.set(id, previous + 1);
      if (previous === 0) {
        ensureTimer(params);
        await pullBoard(params).catch((error: unknown) => {
          input.logger.warn("[pier.tasks] initial board poll failed", error);
        });
      }
    },
    async unwatch(params) {
      const id = encodeScopeId(params);
      const previous = leases.get(id) ?? 0;
      if (previous <= 1) {
        leases.delete(id);
        const timer = timers.get(id);
        if (timer) {
          clearInterval(timer);
          timers.delete(id);
        }
        return;
      }
      leases.set(id, previous - 1);
    },
  };
}

function cardIndex(
  snapshot: TaskBoardSnapshot
): Map<string, { merged: boolean; ready: boolean }> {
  const cards = snapshot.columns.flatMap((column) => column.items);
  return new Map(
    cards.map((card) => [
      card.key,
      {
        merged: card.linkedPRs.some((pr) => pr.merged),
        ready: card.openBlockedByCount === 0,
      },
    ])
  );
}

function diffUnlocked(
  previous: TaskBoardSnapshot,
  next: TaskBoardSnapshot
): { kind: "pr-merged" | "newly-ready" | null; keys: string[] } {
  const before = cardIndex(previous);
  const after = cardIndex(next);
  const merged: string[] = [];
  const ready: string[] = [];
  for (const [key, state] of after) {
    const prior = before.get(key);
    if (!prior) {
      continue;
    }
    if (!prior.merged && state.merged) {
      merged.push(key);
    }
    if (!prior.ready && state.ready) {
      ready.push(key);
    }
  }
  if (merged.length > 0) {
    return { kind: "pr-merged", keys: merged };
  }
  if (ready.length > 0) {
    return { kind: "newly-ready", keys: ready };
  }
  return { kind: null, keys: [] };
}
