import { createLogger } from "@shared/logger.ts";

/**
 * Hourly process-memory rows in the diagnostics JSONL (14d). Warns when a
 * window renderer working set is ≥ MEMORY_SAMPLE_RENDERER_WARN_MB.
 */

const log = createLogger("diagnostics.memory-sample");

export const MEMORY_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;
/** First sample after boot settles (windows restored, plugins loaded). */
export const MEMORY_SAMPLE_INITIAL_DELAY_MS = 5 * 60 * 1000;
export const MEMORY_SAMPLE_RENDERER_WARN_MB = 1024;
export const MEMORY_SAMPLE_EVENT = "process-memory-sample";
export const MEMORY_SAMPLE_WARN_EVENT = "process-memory-high";

/** Electron ProcessMetric subset (memory in KB, per Electron docs). */
export interface MemorySampleMetricInput {
  memory: { peakWorkingSetSize?: number; workingSetSize: number };
  name?: string;
  pid: number;
  serviceName?: string;
  type: string;
}

export interface MemorySampleMainUsage {
  arrayBuffers?: number;
  external: number;
  heapTotal: number;
  heapUsed: number;
  rss: number;
}

export interface MemorySampleProcessRow {
  /** Window id (`main`, `w-1`), page origin, or Electron service name. */
  label: string | null;
  peakWorkingSetMB: number | null;
  pid: number;
  type: string;
  workingSetMB: number;
}

export interface ProcessMemorySample {
  main: {
    arrayBuffersMB: number | null;
    externalMB: number;
    heapTotalMB: number;
    heapUsedMB: number;
    rssMB: number;
  };
  processes: MemorySampleProcessRow[];
  /** Window renderers over the warn threshold (subset of `processes`). */
  rendererOverThreshold: MemorySampleProcessRow[];
  totalWorkingSetMB: number;
}

function mbFromKb(kb: number): number {
  return Math.round((Math.max(0, kb) / 1024) * 10) / 10;
}

function mbFromBytes(bytes: number): number {
  return Math.round((Math.max(0, bytes) / 1_048_576) * 10) / 10;
}

export function buildProcessMemorySample(input: {
  /** Label for a renderer OS pid: internal window id or page origin. */
  describeRendererPid: (pid: number) => string | null;
  mainUsage: MemorySampleMainUsage;
  metrics: readonly MemorySampleMetricInput[];
  rendererWarnMB?: number;
}): ProcessMemorySample {
  const warnMB = input.rendererWarnMB ?? MEMORY_SAMPLE_RENDERER_WARN_MB;
  const processes: MemorySampleProcessRow[] = input.metrics.map((metric) => {
    const label =
      metric.type === "Tab"
        ? input.describeRendererPid(metric.pid)
        : (metric.serviceName ?? metric.name ?? null);
    return {
      label,
      peakWorkingSetMB:
        typeof metric.memory.peakWorkingSetSize === "number"
          ? mbFromKb(metric.memory.peakWorkingSetSize)
          : null,
      pid: metric.pid,
      type: metric.type,
      workingSetMB: mbFromKb(metric.memory.workingSetSize),
    };
  });
  processes.sort((a, b) => b.workingSetMB - a.workingSetMB);
  let totalWorkingSetMB = 0;
  for (const row of processes) {
    totalWorkingSetMB += row.workingSetMB;
  }
  return {
    main: {
      arrayBuffersMB:
        typeof input.mainUsage.arrayBuffers === "number"
          ? mbFromBytes(input.mainUsage.arrayBuffers)
          : null,
      externalMB: mbFromBytes(input.mainUsage.external),
      heapTotalMB: mbFromBytes(input.mainUsage.heapTotal),
      heapUsedMB: mbFromBytes(input.mainUsage.heapUsed),
      rssMB: mbFromBytes(input.mainUsage.rss),
    },
    processes,
    rendererOverThreshold: processes.filter(
      (row) => row.type === "Tab" && row.workingSetMB >= warnMB
    ),
    totalWorkingSetMB: Math.round(totalWorkingSetMB * 10) / 10,
  };
}

export interface ProcessMemorySamplerDeps {
  collect: () => ProcessMemorySample;
  initialDelayMs?: number;
  intervalMs?: number;
  logger?: Pick<typeof log, "info" | "warn">;
  setInterval?: typeof globalThis.setInterval;
  setTimeout?: typeof globalThis.setTimeout;
}

/**
 * Schedule the trail; returns a disposer. Timers are unref'd so they never keep
 * the main process alive. Collection failures are logged once per tick and
 * never throw into the scheduler.
 */
export function installProcessMemorySampler(
  deps: ProcessMemorySamplerDeps
): () => void {
  const logger = deps.logger ?? log;
  const schedule = deps.setTimeout ?? globalThis.setTimeout;
  const repeat = deps.setInterval ?? globalThis.setInterval;
  let intervalTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  let disposed = false;

  const tick = (): void => {
    if (disposed) {
      return;
    }
    let sample: ProcessMemorySample;
    try {
      sample = deps.collect();
    } catch (error) {
      logger.warn("process memory sample failed", { error });
      return;
    }
    logger.info(MEMORY_SAMPLE_EVENT, { ...sample });
    if (sample.rendererOverThreshold.length > 0) {
      logger.warn(MEMORY_SAMPLE_WARN_EVENT, {
        renderers: sample.rendererOverThreshold,
        thresholdMB: MEMORY_SAMPLE_RENDERER_WARN_MB,
      });
    }
  };

  const initialTimer = schedule(() => {
    tick();
    if (disposed) {
      return;
    }
    intervalTimer = repeat(tick, deps.intervalMs ?? MEMORY_SAMPLE_INTERVAL_MS);
    (intervalTimer as { unref?: () => void }).unref?.();
  }, deps.initialDelayMs ?? MEMORY_SAMPLE_INITIAL_DELAY_MS);
  (initialTimer as { unref?: () => void }).unref?.();

  return () => {
    disposed = true;
    clearTimeout(initialTimer);
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };
}
