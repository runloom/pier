import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Pre-crash hang forensics.
 *
 * `unresponsive` means the renderer main thread has not answered input for
 * seconds. By the time we force-crash it the JS stack is gone, so keep a
 * bounded native sample on disk first. macOS `sample` attaches to the live
 * renderer without stopping it and writes one text file; we cap it so the
 * recovery page is delayed by at most a couple of seconds.
 */

const SAMPLE_BINARY = "/usr/bin/sample";

export const RENDERER_HANG_SAMPLE_TIMEOUT_MS = 2000;
export const RENDERER_HANG_SAMPLE_SECONDS = 1;

export type RendererHangSampleFailureReason =
  | "invalid-pid"
  | "no-diagnostics-dir"
  | "nonzero-exit"
  | "platform"
  | "spawn-error"
  | "timeout";

export interface RendererHangSampleResult {
  error?: string;
  file: string | null;
  ok: boolean;
  reason?: RendererHangSampleFailureReason;
}

interface AppMetricLike {
  cpu?: { percentCPUUsage?: number };
  memory?: {
    peakWorkingSetSize?: number;
    workingSetSize?: number;
  };
  pid: number;
  type: string;
}

export interface RendererProcessMetricSnapshot {
  cpuPercent: number | null;
  peakWorkingSetMb: number | null;
  pid: number;
  type: string;
  workingSetMb: number | null;
}

export interface CaptureRendererHangSampleInput {
  diagnosticsDir: string | null;
  incidentId: string;
  pid: number | null;
  platform?: NodeJS.Platform;
  spawnFn?: typeof spawn;
  timeoutMs?: number;
}

function mbFromKb(kb: number | undefined): number | null {
  if (typeof kb !== "number" || !Number.isFinite(kb)) {
    return null;
  }
  return Math.round(kb / 1024);
}

/** Match the hung renderer in `app.getAppMetrics()` (memory is KB there). */
export function findRendererProcessMetric(
  metrics: readonly AppMetricLike[],
  pid: number | null
): RendererProcessMetricSnapshot | null {
  if (pid === null) {
    return null;
  }
  const metric = metrics.find((candidate) => candidate.pid === pid);
  if (!metric) {
    return null;
  }
  return {
    cpuPercent:
      typeof metric.cpu?.percentCPUUsage === "number"
        ? Math.round(metric.cpu.percentCPUUsage * 10) / 10
        : null,
    peakWorkingSetMb: mbFromKb(metric.memory?.peakWorkingSetSize),
    pid: metric.pid,
    type: metric.type,
    workingSetMb: mbFromKb(metric.memory?.workingSetSize),
  };
}

export async function captureRendererHangSample(
  input: CaptureRendererHangSampleInput
): Promise<RendererHangSampleResult> {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    return { file: null, ok: false, reason: "platform" };
  }
  if (input.pid === null || !Number.isInteger(input.pid) || input.pid <= 0) {
    return { file: null, ok: false, reason: "invalid-pid" };
  }
  if (input.diagnosticsDir === null || input.diagnosticsDir.length === 0) {
    return { file: null, ok: false, reason: "no-diagnostics-dir" };
  }

  const file = join(
    input.diagnosticsDir,
    `hang-${input.incidentId}-${input.pid}.txt`
  );
  const spawnFn = input.spawnFn ?? spawn;
  const timeoutMs = input.timeoutMs ?? RENDERER_HANG_SAMPLE_TIMEOUT_MS;

  return await new Promise<RendererHangSampleResult>((resolve) => {
    let child: ChildProcess | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: RendererHangSampleResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(result);
    };

    timer = setTimeout(() => {
      timer = null;
      try {
        child?.kill("SIGKILL");
      } catch {
        // The sampler may have exited between the timer and this callback.
      }
      finish({ file, ok: false, reason: "timeout" });
    }, timeoutMs);

    try {
      child = spawnFn(
        SAMPLE_BINARY,
        [
          String(input.pid),
          String(RENDERER_HANG_SAMPLE_SECONDS),
          "-file",
          file,
        ],
        { stdio: "ignore" }
      );
    } catch (error) {
      finish({
        error: error instanceof Error ? error.message : String(error),
        file,
        ok: false,
        reason: "spawn-error",
      });
      return;
    }

    child.on("error", (error) => {
      finish({
        error: error.message,
        file,
        ok: false,
        reason: "spawn-error",
      });
    });
    child.on("exit", (code) => {
      finish(
        code === 0
          ? { file, ok: true }
          : {
              error: `exit ${String(code)}`,
              file,
              ok: false,
              reason: "nonzero-exit",
            }
      );
    });
  });
}
