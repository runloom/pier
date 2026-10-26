import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Pre-crash hang forensics.
 *
 * `unresponsive` means the renderer main thread has not answered input for
 * seconds. By the time we force-crash it the JS stack is gone, so keep a
 * bounded native sample on disk first. macOS `sample` attaches to the live
 * renderer without stopping it and writes one text file.
 *
 * 预算按「进程卡在 GC/JIT 里时挂载也很慢」定：事故 08a3a7ffd9fa 用
 * 2s 超时 + 1s 采样，采样器还没挂上就被结束，栈文件根本没生成。
 * 现在采样时长 3s、总超时 6s（3s 采样 + 3s 挂载余量）。
 *
 * 两条已实测的陷阱（别再踩）：
 * - `sample` 只有在采样**结束**时才写文件。中途 kill 掉不会留下半份栈，
 *   所以超时结果不能报告一个不存在的路径。
 * - `sample` 写不了文件时（目录只读、父目录不存在）仍然 exit 0，
 *   错误只出现在 stderr。因此 exit 0 不能当作成功，必须核实文件真的存在。
 */

const SAMPLE_BINARY = "/usr/bin/sample";

export const RENDERER_HANG_SAMPLE_TIMEOUT_MS = 6000;
export const RENDERER_HANG_SAMPLE_SECONDS = 3;

/** stderr 只留够归因的量（挂载失败、权限、pid 不存在），不进日志正文。 */
const MAX_STDERR_CHARS = 512;

export type RendererHangSampleFailureReason =
  | "invalid-pid"
  | "no-diagnostics-dir"
  | "no-file"
  | "nonzero-exit"
  | "platform"
  | "spawn-error"
  | "timeout";

export interface RendererHangSampleResult {
  error?: string;
  /**
   * 采样器写出的栈文件；只有确认存在时才非 null。超时被杀时 `sample`
   * 还什么都没写，这里就是 null。
   */
  file: string | null;
  ok: boolean;
  reason?: RendererHangSampleFailureReason;
  /** 采样器 stderr（截断）。挂载失败的解释只在这里。 */
  stderr?: string;
}

export interface AppMetricLike {
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
  /** 栈文件是否真的生成；测试注入用，默认查磁盘。 */
  fileExists?: (file: string) => boolean;
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
  const fileExists = input.fileExists ?? existsSync;

  return await new Promise<RendererHangSampleResult>((resolve) => {
    let child: ChildProcess | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    /**
     * 采样器 stderr。挂载失败、权限不足、pid 消失的解释只在这里，
     * `sample` 遇到这些情况通常仍然 exit 0。
     */
    let stderr = "";

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

    /** 只有磁盘上真有文件才报告路径，避免日志指向不存在的栈。 */
    const reportedFile = (): string | null => (fileExists(file) ? file : null);

    timer = setTimeout(() => {
      timer = null;
      try {
        child?.kill("SIGKILL");
      } catch {
        // The sampler may have exited between the timer and this callback.
      }
      // `sample` 只在采样结束后才写文件，中途被杀不会留下半份栈。
      finish({
        file: reportedFile(),
        ok: false,
        reason: "timeout",
        ...(stderr.length > 0 ? { stderr } : {}),
      });
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
        { stdio: ["ignore", "ignore", "pipe"] }
      );
    } catch (error) {
      finish({
        error: error instanceof Error ? error.message : String(error),
        file: null,
        ok: false,
        reason: "spawn-error",
      });
      return;
    }

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length >= MAX_STDERR_CHARS) {
        return;
      }
      const room = MAX_STDERR_CHARS - stderr.length;
      const text = String(chunk);
      stderr += text.length <= room ? text : text.slice(0, room);
    });

    child.on("error", (error) => {
      finish({
        error: error.message,
        file: null,
        ok: false,
        reason: "spawn-error",
      });
    });
    // `close` 而非 `exit`：管道 stdio 只在 close 时保证读完，
    // 用 exit 会与最后一段 stderr 抢跑，把「为什么没挂上」丢掉。
    child.on("close", (code) => {
      const written = fileExists(file);
      if (code === 0 && written) {
        finish({ file, ok: true });
        return;
      }
      let error: string;
      if (stderr.length > 0) {
        error = stderr;
      } else if (written) {
        error = `exit ${String(code)}`;
      } else {
        error = `exit ${String(code)} without stack file`;
      }
      finish({
        error,
        file: written ? file : null,
        ok: false,
        reason: written ? "nonzero-exit" : "no-file",
        ...(stderr.length > 0 ? { stderr } : {}),
      });
    });
  });
}
