import type {
  TaskRunControlEntry,
  TaskRunNodeStatus,
} from "@shared/contracts/tasks.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  taskRunsForPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";

export const RUNTIME_CONTROL_EXIT_MS = 180;
export const RUNTIME_CONTROL_SUCCESS_LINGER_MS = 5000;
export const RUNTIME_CONTROL_CANCELLED_LINGER_MS = 3000;

export type TerminalRuntimeControlPhase = "exiting" | "visible";

interface TerminalRuntimeControlPresentation {
  dismissRun(runId: string): void;
  mounted: boolean;
  now: number;
  phase: TerminalRuntimeControlPhase;
  runs: readonly TaskRunControlEntry[];
  setAutoExitPause(paused: boolean): void;
}

type InternalPhase = "exiting" | "hidden" | "visible";

export function isActiveTaskRunStatus(status: TaskRunNodeStatus): boolean {
  return status === "pending" || status === "running" || status === "stopping";
}

export function isPersistentTaskRun(run: TaskRunControlEntry): boolean {
  if (run.status === "failed" || run.status === "blocked") {
    return true;
  }
  return (
    run.status === "cancelled" &&
    Object.values(run.nodes).some((node) => node.termination === "force")
  );
}

function logicalTaskRunKey(run: TaskRunControlEntry): string {
  return `${run.projectRootPath}\0${run.rootTaskId}\0${run.mode}`;
}

function compareTaskRuns(
  left: TaskRunControlEntry,
  right: TaskRunControlEntry
): number {
  return (
    Number(isActiveTaskRunStatus(right.status)) -
      Number(isActiveTaskRunStatus(left.status)) ||
    right.updatedAt - left.updatedAt ||
    right.startedAt - left.startedAt ||
    left.runId.localeCompare(right.runId)
  );
}

/**
 * 把运行历史投影为运行控制器需要的“当前任务”列表。
 *
 * 同一逻辑任务的终态运行只保留最新一次，避免每次重新运行都在选择器中新增一项；
 * 若存在仍活跃的并发运行，则全部保留，确保每个真实进程仍可被单独控制。
 */
export function currentTaskRunsByLogicalTask(
  runs: readonly TaskRunControlEntry[]
): TaskRunControlEntry[] {
  const runsByTask = new Map<string, TaskRunControlEntry[]>();
  for (const run of runs) {
    const key = logicalTaskRunKey(run);
    const current = runsByTask.get(key);
    if (current) {
      current.push(run);
    } else {
      runsByTask.set(key, [run]);
    }
  }

  const currentRuns: TaskRunControlEntry[] = [];
  for (const taskRuns of runsByTask.values()) {
    const ordered = taskRuns.toSorted(compareTaskRuns);
    const activeRuns = ordered.filter((run) =>
      isActiveTaskRunStatus(run.status)
    );
    if (activeRuns.length > 0) {
      currentRuns.push(...activeRuns);
    } else if (ordered[0]) {
      currentRuns.push(ordered[0]);
    }
  }
  return currentRuns.toSorted(compareTaskRuns);
}

function lingerDuration(status: TaskRunNodeStatus): number {
  return status === "cancelled"
    ? RUNTIME_CONTROL_CANCELLED_LINGER_MS
    : RUNTIME_CONTROL_SUCCESS_LINGER_MS;
}

function shouldPresentRun(
  run: TaskRunControlEntry,
  now: number,
  dismissedRunIds: ReadonlySet<string>,
  pausedMs: number
): boolean {
  if (dismissedRunIds.has(run.runId)) {
    return false;
  }
  if (isActiveTaskRunStatus(run.status)) {
    return true;
  }
  if (isPersistentTaskRun(run)) {
    return true;
  }
  const effectiveElapsed = now - run.updatedAt - pausedMs;
  return effectiveElapsed < lingerDuration(run.status);
}

function reducedMotionEnabled(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function sameRuns(
  left: readonly TaskRunControlEntry[],
  right: readonly TaskRunControlEntry[]
): boolean {
  return (
    left.length === right.length &&
    left.every((run, index) => run === right[index])
  );
}

/**
 * 运行控制浮层的唯一呈现状态机。
 *
 * 任务运行状态仍由 TaskService / taskRuns store 所有；这里仅负责严重程度分级、
 * 用户关闭和退出在场管理。退出阶段冻结最后一次完整 runs，保证内容与容器作为
 * 一个整体退场，不会先渲染空壳。
 */
export function useTerminalRuntimeControlPresentation(
  panelId: string
): TerminalRuntimeControlPresentation {
  const snapshot = useTaskRunsStore((state) => state.snapshot);
  const [dismissedRunIds, setDismissedRunIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [now, setNow] = useState(() => Date.now());
  const panelRuns = useMemo(
    () => taskRunsForPanel(snapshot, panelId),
    [panelId, snapshot]
  );
  const currentRuns = useMemo(
    () => currentTaskRunsByLogicalTask(panelRuns),
    [panelRuns]
  );
  const pauseStartedAtRef = useRef<number | null>(null);
  const pausedMsByRunIdRef = useRef<Map<string, number>>(new Map());
  const currentRunsRef = useRef(currentRuns);
  currentRunsRef.current = currentRuns;
  const [, setPauseRevision] = useState(0);
  const pauseStartedAt = pauseStartedAtRef.current;
  const eligibleRuns = currentRuns.filter((run) => {
    const accumulatedPause = pausedMsByRunIdRef.current.get(run.runId) ?? 0;
    const openPause =
      pauseStartedAt === null
        ? 0
        : Math.max(0, now - Math.max(pauseStartedAt, run.updatedAt));
    return shouldPresentRun(
      run,
      now,
      dismissedRunIds,
      accumulatedPause + openPause
    );
  });
  const [retainedRuns, setRetainedRuns] = useState<
    readonly TaskRunControlEntry[]
  >(() => eligibleRuns);
  const retainedRunsRef = useRef<readonly TaskRunControlEntry[]>(eligibleRuns);
  const [phase, setPhaseState] = useState<InternalPhase>(() =>
    eligibleRuns.length > 0 ? "visible" : "hidden"
  );
  const phaseRef = useRef<InternalPhase>(phase);
  const exitTimerRef = useRef<number | null>(null);

  const setPhase = useCallback((next: InternalPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      clearExitTimer();
    },
    [clearExitTimer]
  );

  useEffect(() => {
    const currentRunIds = new Set(currentRuns.map((run) => run.runId));
    for (const runId of pausedMsByRunIdRef.current.keys()) {
      if (!currentRunIds.has(runId)) {
        pausedMsByRunIdRef.current.delete(runId);
      }
    }
  }, [currentRuns]);

  useLayoutEffect(() => {
    if (eligibleRuns.length > 0) {
      clearExitTimer();
      if (!sameRuns(retainedRunsRef.current, eligibleRuns)) {
        retainedRunsRef.current = eligibleRuns;
        setRetainedRuns(eligibleRuns);
      }
      setPhase("visible");
      return;
    }
    if (retainedRunsRef.current.length === 0) {
      setPhase("hidden");
      return;
    }
    if (phaseRef.current === "exiting") {
      return;
    }

    setPhase("exiting");
    exitTimerRef.current = window.setTimeout(
      () => {
        exitTimerRef.current = null;
        retainedRunsRef.current = [];
        setRetainedRuns([]);
        setPhase("hidden");
      },
      reducedMotionEnabled() ? 0 : RUNTIME_CONTROL_EXIT_MS
    );
  }, [clearExitTimer, eligibleRuns, setPhase]);

  const dismissRun = useCallback((runId: string) => {
    setDismissedRunIds((current) => {
      if (current.has(runId)) {
        return current;
      }
      return new Set([...current, runId]);
    });
  }, []);

  const setAutoExitPause = useCallback((paused: boolean) => {
    if (paused) {
      if (pauseStartedAtRef.current !== null) {
        return;
      }
      pauseStartedAtRef.current = Date.now();
      setPauseRevision((current) => current + 1);
      return;
    }

    const pauseStartedAt = pauseStartedAtRef.current;
    if (pauseStartedAt === null) {
      return;
    }
    const pauseEndedAt = Date.now();
    pauseStartedAtRef.current = null;
    const currentRunIds = new Set<string>();
    for (const run of currentRunsRef.current) {
      currentRunIds.add(run.runId);
      if (isActiveTaskRunStatus(run.status) || isPersistentTaskRun(run)) {
        continue;
      }
      const overlap = Math.max(
        0,
        pauseEndedAt - Math.max(pauseStartedAt, run.updatedAt)
      );
      if (overlap > 0) {
        const accumulated = pausedMsByRunIdRef.current.get(run.runId) ?? 0;
        pausedMsByRunIdRef.current.set(run.runId, accumulated + overlap);
      }
    }
    for (const runId of pausedMsByRunIdRef.current.keys()) {
      if (!currentRunIds.has(runId)) {
        pausedMsByRunIdRef.current.delete(runId);
      }
    }
    setPauseRevision((current) => current + 1);
  }, []);

  const runs = eligibleRuns.length > 0 ? eligibleRuns : retainedRuns;
  return {
    dismissRun,
    mounted: runs.length > 0,
    now,
    phase: eligibleRuns.length > 0 || phase === "hidden" ? "visible" : phase,
    runs,
    setAutoExitPause,
  };
}
