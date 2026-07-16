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
import { notifyTaskRunFinishedIfNeeded } from "./notify-task-run-finished.ts";

export const RUNTIME_CONTROL_EXIT_MS = 180;

export type TerminalRuntimeControlPhase = "exiting" | "visible";

interface TerminalRuntimeControlPresentation {
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

/** @deprecated 终态一律 linger 后退场；保留导出供旧测试/调用方过渡。 */
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

function shouldPresentRun(run: TaskRunControlEntry): boolean {
  // 终态由 toast（查看详情）承接；浮层只覆盖活跃进程控制。
  return isActiveTaskRunStatus(run.status);
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
 * 任务运行状态仍由 TaskService / taskRuns store 所有；这里仅负责退出在场管理。
 * 活跃任务显示控制条；进入终态后立即退场，由 toast（含查看详情）承接结果反馈。
 * 退出阶段冻结最后一次完整 runs，保证内容与容器作为一个整体退场。
 */
export function useTerminalRuntimeControlPresentation(
  panelId: string
): TerminalRuntimeControlPresentation {
  const snapshot = useTaskRunsStore((state) => state.snapshot);
  const [now, setNow] = useState(() => Date.now());
  const panelRuns = useMemo(
    () => taskRunsForPanel(snapshot, panelId),
    [panelId, snapshot]
  );
  const currentRuns = useMemo(
    () => currentTaskRunsByLogicalTask(panelRuns),
    [panelRuns]
  );
  const eligibleRuns = currentRuns.filter(shouldPresentRun);
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
    for (const run of currentRuns) {
      notifyTaskRunFinishedIfNeeded(run);
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

    // 终态不单独挂载：只有从可见活跃态退出时才播退场动画。
    if (phaseRef.current === "hidden" || retainedRunsRef.current.length === 0) {
      clearExitTimer();
      if (retainedRunsRef.current.length > 0) {
        retainedRunsRef.current = [];
        setRetainedRuns([]);
      }
      setPhase("hidden");
      return;
    }

    if (phaseRef.current === "exiting") {
      return;
    }

    const exitRuns =
      currentRuns.length > 0 ? currentRuns : retainedRunsRef.current;
    if (!sameRuns(retainedRunsRef.current, exitRuns)) {
      retainedRunsRef.current = exitRuns;
      setRetainedRuns(exitRuns);
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
  }, [clearExitTimer, currentRuns, eligibleRuns, setPhase]);

  // 终态已无 linger；保留 API 以兼容浮层 interaction 接线。
  const setAutoExitPause = useCallback((_paused: boolean) => {}, []);

  const runs = eligibleRuns.length > 0 ? eligibleRuns : retainedRuns;
  return {
    mounted: runs.length > 0,
    now,
    phase: eligibleRuns.length > 0 || phase === "hidden" ? "visible" : phase,
    runs,
    setAutoExitPause,
  };
}
