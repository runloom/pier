import { isActiveTaskRunNodeStatus } from "@shared/contracts/task-run-status.ts";
import type {
  TaskRunControlEntry,
  TaskRunNodeStatus,
} from "@shared/contracts/tasks.ts";
import { createLogger } from "@shared/logger.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { reportTaskRuntimeDiagnostic } from "@/lib/tasks/report-runtime-diagnostic.ts";
import { useTaskRunControlDismissStore } from "@/stores/task-run-control-dismiss.store.ts";
import {
  panelHasActiveTaskRun,
  taskRunsForPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";

const log = createLogger("task.runtime.rc");

export const RUNTIME_CONTROL_EXIT_MS = 180;

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

/** 与 tab 蓝点 / shared isActiveTaskRunNodeStatus 单一来源，禁止再分叉。 */
export function isActiveTaskRunStatus(status: TaskRunNodeStatus): boolean {
  return isActiveTaskRunNodeStatus(status);
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

/**
 * 控制条是否应对该 run 在场。
 *
 * - **活跃**（pending / running / stopping）：始终在场，dismiss 无效。
 *   与 tab「活跃任务」蓝点同源：有活跃 run ⇔ 必有 RC（禁止「有点无条」）。
 * - **终态**：dismiss 后离场（重跑/关闭条，不点蓝点）。
 */
export function shouldPresentRun(
  run: TaskRunControlEntry,
  dismissedRunIds: ReadonlySet<string>
): boolean {
  if (isActiveTaskRunStatus(run.status)) {
    return true;
  }
  if (dismissedRunIds.has(run.runId)) {
    return false;
  }
  return true;
}

/**
 * 不变量：RC 作用域内存在 presentable run 时，RC 应 mount。
 * 纯函数供单测与治理锁定（agent 无 TaskRun 时返回 false）。
 *
 * 与 `panelHasActiveTaskRun` 的关系：
 * - 任一活跃 run → 两者皆 true（active 不看 dismiss）
 * - 仅终态未 dismiss → RC true、tab 蓝点 false（终态控制条，非「在跑」）
 */
export function panelShouldMountRuntimeControl(
  runsForPanel: readonly TaskRunControlEntry[],
  dismissedRunIds: ReadonlySet<string>
): boolean {
  const current = currentTaskRunsByLogicalTask(runsForPanel);
  return current.some((run) => shouldPresentRun(run, dismissedRunIds));
}

/**
 * 活跃任务 presence 是否强制 RC 在场。
 * 供单测锁定：panelHasActiveTaskRun ⇒ RC mount（任意 dismiss 集合）。
 */
export function activeTaskRunImpliesRuntimeControl(
  hasActiveTaskRun: boolean,
  runsForPanel: readonly TaskRunControlEntry[],
  dismissedRunIds: ReadonlySet<string>
): boolean {
  if (!hasActiveTaskRun) {
    return true;
  }
  return panelShouldMountRuntimeControl(runsForPanel, dismissedRunIds);
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
 * 活跃与终态均保留控制条（停止→关闭 / 重新运行）；用户 dismiss 后才退场。
 * 后台「关闭」只 dismiss 控制条，不关发起终端（方案 A）。
 */
export function useTerminalRuntimeControlPresentation(
  panelId: string
): TerminalRuntimeControlPresentation {
  const snapshot = useTaskRunsStore((state) => state.snapshot);
  const dismissed = useTaskRunControlDismissStore((state) => state.dismissed);
  const [now, setNow] = useState(() => Date.now());
  const dismissedRunIds = useMemo(
    () => new Set(Object.keys(dismissed)),
    [dismissed]
  );
  const panelRuns = useMemo(
    () => taskRunsForPanel(snapshot, panelId),
    [panelId, snapshot]
  );
  const currentRuns = useMemo(
    () => currentTaskRunsByLogicalTask(panelRuns),
    [panelRuns]
  );
  const eligibleRuns = useMemo(
    () => currentRuns.filter((run) => shouldPresentRun(run, dismissedRunIds)),
    [currentRuns, dismissedRunIds]
  );
  const hasActiveTask = useMemo(
    () => panelHasActiveTaskRun(snapshot, panelId),
    [panelId, snapshot]
  );
  const [retainedRuns, setRetainedRuns] = useState<
    readonly TaskRunControlEntry[]
  >(() => eligibleRuns);
  const retainedRunsRef = useRef<readonly TaskRunControlEntry[]>(eligibleRuns);
  const [phase, setPhaseState] = useState<InternalPhase>(() =>
    eligibleRuns.length > 0 ? "visible" : "hidden"
  );
  const phaseRef = useRef<InternalPhase>(phase);
  const exitTimerRef = useRef<number | null>(null);
  const lastPresenceLogRef = useRef<string>("");

  useEffect(() => {
    const signature = [
      panelId,
      hasActiveTask ? "1" : "0",
      eligibleRuns.map((run) => `${run.runId}:${run.status}`).join(","),
    ].join("|");
    if (signature === lastPresenceLogRef.current) {
      return;
    }
    lastPresenceLogRef.current = signature;
    const presence = {
      eligible: eligibleRuns.map((run) => ({
        mode: run.mode,
        originPanelId: run.originPanelId,
        runId: run.runId,
        status: run.status,
      })),
      hasActiveTask,
      mounted: eligibleRuns.length > 0,
      panelId,
      panelRunCount: panelRuns.length,
      snapshotRunCount: Object.keys(snapshot.runs).length,
      snapshotVersion: snapshot.version,
    };
    log.debug("RC presence", presence);
    reportTaskRuntimeDiagnostic("task.runtime.rc", "RC presence", presence);
  }, [
    eligibleRuns,
    hasActiveTask,
    panelId,
    panelRuns.length,
    snapshot.runs,
    snapshot.version,
  ]);

  const setPhase = useCallback((next: InternalPhase) => {
    if (phaseRef.current === next) {
      return;
    }
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const dismissRun = useCallback((runId: string) => {
    useTaskRunControlDismissStore.getState().dismiss(runId);
  }, []);

  // 活跃（含 stopping）不可 dismiss 藏条；终态 dismiss 后离场。
  // 重新运行分配新 runId，天然可展示。

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

  const setAutoExitPause = useCallback((_paused: boolean) => {}, []);

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
