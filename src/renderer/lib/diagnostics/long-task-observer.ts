import {
  type RendererHangBreadcrumb,
  sanitizeHangBreadcrumbFields,
} from "@shared/contracts/diagnostics/hang-breadcrumb.ts";

/**
 * Long-task evidence for the hang trail.
 *
 * 事故复盘要点：renderer 被判定无响应时，main 侧只能拿到心跳停止的时刻，
 * 拿不到「是哪个同步任务把主线程占住了」。macOS `sample` 对 Electron renderer
 * 经常只给到 V8/JIT 的 `???` 帧（事故 efbfd91ee1ac），挂载太慢还会直接超时
 * （事故 08a3a7ffd9fa）。`PerformanceObserver("longtask")` 是唯一能在阻塞结束后、
 * 由浏览器自己量出时长与开始时刻的入口。
 *
 * 纪律：
 * - 只在任务**结束后**记录，入队是 O(1)，不参与阻塞路径。
 * - `longtask` 属于 immediate 类型，下一次真正卡死的任务不会把这些记录困在缓冲里。
 * - 节流只决定**何时发射**；条数与聚合口径的唯一来源是 `buildLongTaskBreadcrumbs`。
 * - 一次发射只发一条 IPC：逐条发送会让 main 侧环形缓冲区被长任务灌满。
 */

/** 只记够长的任务；200ms 以下对「卡死 20 秒」几乎没有解释力。 */
export const LONG_TASK_MIN_DURATION_MS = 200;

/** 一批里最多产出多少条；更早的只累加成一条 `suppressed N`。 */
export const LONG_TASK_BURST_LIMIT = 6;

/** 两次发射之间的最小间隔，避免循环长任务刷屏。 */
export const LONG_TASK_MIN_GAP_MS = 1000;

/** 待发射样本的硬上限；超出部分计入 `suppressed`，不静默消失。 */
export const LONG_TASK_BUFFER_MAX = 64;

export interface LongTaskSample {
  durationMs: number;
  /** 任务开始时刻（`performance.now()` 基准）。 */
  startTime: number;
}

interface LongTaskObserverState {
  dispose: () => void;
  flush: () => void;
}

let installedObserver: LongTaskObserverState | null = null;

function now(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function isQualifying(sample: LongTaskSample, minDurationMs: number): boolean {
  return (
    Number.isFinite(sample.durationMs) &&
    Number.isFinite(sample.startTime) &&
    sample.durationMs >= minDurationMs
  );
}

function toDetail(
  sample: LongTaskSample,
  suppressedCount: number,
  sincePreviousMs: number | null
): string {
  const parts = [
    `longtask ${Math.round(sample.durationMs)}ms`,
    `start ${Math.round(sample.startTime)}`,
  ];
  if (sincePreviousMs !== null) {
    parts.push(`gap ${Math.round(sincePreviousMs)}`);
  }
  if (suppressedCount > 0) {
    parts.push(`suppressed ${suppressedCount}`);
  }
  return parts.join(" ");
}

/**
 * 把一批长任务样本压成最多 `burstLimit` 条 breadcrumb（保留最新的几条）。
 *
 * 纯函数，便于在不依赖 `PerformanceObserver` 的测试里锁住聚合口径。
 * 返回的 payload 已按契约 clamp，可直接交给 `noteHangBreadcrumb`。
 *
 * `suppressedCount` 是调用方在入队前就丢掉的条数（缓冲区溢出），
 * 与这里因 burst 截断的条数合并成同一个计数。
 */
export function buildLongTaskBreadcrumbs(
  samples: readonly LongTaskSample[],
  options: {
    burstLimit?: number;
    minDurationMs?: number;
    suppressedCount?: number;
  } = {}
): RendererHangBreadcrumb[] {
  const burstLimit = Math.max(1, options.burstLimit ?? LONG_TASK_BURST_LIMIT);
  const minDurationMs = options.minDurationMs ?? LONG_TASK_MIN_DURATION_MS;
  const qualifying = samples
    .filter((sample) => isQualifying(sample, minDurationMs))
    .sort((left, right) => left.startTime - right.startTime);
  if (qualifying.length === 0) {
    return [];
  }
  const emitted = qualifying.slice(-burstLimit);
  const suppressedCount =
    qualifying.length -
    emitted.length +
    Math.max(0, options.suppressedCount ?? 0);
  const crumbs: RendererHangBreadcrumb[] = [];
  let previousStart: number | null = null;
  for (let index = 0; index < emitted.length; index += 1) {
    const sample = emitted[index]!;
    const isLast = index === emitted.length - 1;
    const sincePrevious =
      previousStart === null ? null : sample.startTime - previousStart;
    previousStart = sample.startTime;
    crumbs.push(
      sanitizeHangBreadcrumbFields({
        detail: toDetail(sample, isLast ? suppressedCount : 0, sincePrevious),
        kind: "longtask",
        phase: "state",
      })
    );
  }
  return crumbs;
}

export interface LongTaskObserverOptions {
  burstLimit?: number;
  createObserver?: (
    callback: (entries: readonly LongTaskSample[]) => void
  ) => { disconnect: () => void } | null;
  minDurationMs?: number;
  minGapMs?: number;
  /** 一次发射的整批记录，调用方应合并成一次 IPC。 */
  noteBatch: (payloads: readonly RendererHangBreadcrumb[]) => void;
}

function createDefaultObserver(
  callback: (entries: readonly LongTaskSample[]) => void
): { disconnect: () => void } | null {
  if (typeof PerformanceObserver === "undefined") {
    return null;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      callback(
        list.getEntries().map((entry) => ({
          durationMs: entry.duration,
          startTime: entry.startTime,
        }))
      );
    });
    observer.observe({ entryTypes: ["longtask"] });
    return { disconnect: () => observer.disconnect() };
  } catch {
    return null;
  }
}

/**
 * 安装长任务观测，返回 dispose。后装先卸，且卸载前先 flush：
 * 已经量到的阻塞不能因为一次重装就消失。
 *
 * 浏览器不支持 `longtask` 时静默跳过，同时清掉旧观察者——留一个没有主人的
 * 观察者继续写日志比不观测更糟。
 */
export function installLongTaskObserver(
  options: LongTaskObserverOptions
): () => void {
  const minGapMs = options.minGapMs ?? LONG_TASK_MIN_GAP_MS;
  const minDurationMs = options.minDurationMs ?? LONG_TASK_MIN_DURATION_MS;
  const buildOptions = {
    ...(options.burstLimit === undefined
      ? {}
      : { burstLimit: options.burstLimit }),
    minDurationMs,
  };

  let buffered: LongTaskSample[] = [];
  /** 被缓冲上限挤掉、还没报出去的条数。 */
  let droppedCount = 0;
  let lastEmittedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (): void => {
    cancelTimer();
    if (buffered.length === 0) {
      return;
    }
    const samples = buffered;
    const suppressedCount = droppedCount;
    buffered = [];
    droppedCount = 0;
    const crumbs = buildLongTaskBreadcrumbs(samples, {
      ...buildOptions,
      suppressedCount,
    });
    if (crumbs.length === 0) {
      return;
    }
    // 只有真的产出记录才推进节流窗口：一批全被阈值滤掉的样本
    // 不应该把下一次真正阻塞的任务推迟到窗口结束。
    lastEmittedAt = now();
    options.noteBatch(crumbs);
  };

  const schedule = (delayMs: number): void => {
    if (timer !== null) {
      return;
    }
    timer = setTimeout(
      () => {
        timer = null;
        emit();
      },
      Math.max(0, delayMs)
    );
  };

  const accept = (entries: readonly LongTaskSample[]): boolean => {
    const qualifying = entries.filter((entry) =>
      isQualifying(entry, minDurationMs)
    );
    if (qualifying.length === 0) {
      return false;
    }
    buffered.push(...qualifying);
    if (buffered.length > LONG_TASK_BUFFER_MAX) {
      const overflow = buffered.length - LONG_TASK_BUFFER_MAX;
      // 筛过阈值再截断，短任务挤不掉真正阻塞的那条。
      buffered = buffered.slice(-LONG_TASK_BUFFER_MAX);
      droppedCount += overflow;
    }
    return true;
  };

  const observer = (options.createObserver ?? createDefaultObserver)(
    (entries) => {
      if (entries.length === 0) {
        return;
      }
      if (!accept(entries)) {
        return;
      }
      const elapsed = lastEmittedAt === null ? null : now() - lastEmittedAt;
      if (elapsed === null || elapsed >= minGapMs) {
        emit();
        return;
      }
      // 节流窗口内：样本留在缓冲里，窗口结束后一次性发射。
      schedule(minGapMs - elapsed);
    }
  );

  if (observer === null) {
    installedObserver?.dispose();
    installedObserver = null;
    return () => undefined;
  }

  const state: LongTaskObserverState = {
    dispose: () => {
      // 先吐已量到的记录，再拆观察者。
      emit();
      cancelTimer();
      observer.disconnect();
      if (installedObserver === state) {
        installedObserver = null;
      }
    },
    flush: emit,
  };
  installedObserver?.dispose();
  installedObserver = state;
  return state.dispose;
}

/** 页面卸载前把还在节流窗口里的长任务吐出去，避免随进程消失。 */
export function flushPendingLongTasks(): void {
  installedObserver?.flush();
}

export function __resetLongTaskObserverForTests(): void {
  installedObserver?.dispose();
  installedObserver = null;
}
