import type { Logger } from "@shared/logger.ts";
import type { WebContents } from "electron";

/**
 * 卡死时抓「函数级」JS 栈。
 *
 * 背景（incident 1ebe98431795）：renderer 主线程被递归式同步 JS 独占，
 * `/usr/bin/sample` 只能给出 V8 JIT 匿名地址；`--perf-basic-prof` 在
 * 沙箱 renderer 里会直接 fatal（`perf_output_handle_ != nullptr`，实测），
 * 不能作为生产取证手段。
 *
 * 这里利用 DevTools 协议的 `Debugger.pause`：V8 的暂停走 isolate 中断，
 * 主线程即使正卡在死循环里也能被打断；`Debugger.paused` 带回
 * functionName / url / lineNumber / columnNumber。实测常驻 attach +
 * `Debugger.enable` 对纯计算基线无可测开销（27ms vs 25ms），暂停命令
 * 在忙循环中 1ms 内生效。
 *
 * 约束：
 * - 只在已经确认「仍无响应、即将 force-crash」时暂停，避免把本来能恢复的
 *   renderer 按在暂停态；抓完统一 resume，超时则 disable 清掉
 *   pause-on-next-statement 残留。
 * - 常驻 attach + enable：卡死后再 enable 的协议消息排不进主线程。
 * - 每 30s 采一次 `Runtime.getHeapUsage` / `Memory.getDOMCounters`，
 *   给 breadcrumb 补真实 JS heap / DOM 节点数（两者均无需 enable 域）。
 */

const DEBUGGER_PROTOCOL_VERSION = "1.3";
export const RENDERER_HANG_STACK_PAUSE_TIMEOUT_MS = 1500;
const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 30_000;
const MAX_STACK_FRAMES = 48;
const MAX_FRAME_NAME_CHARS = 120;
const MAX_FRAME_URL_CHARS = 160;
const MB = 1024 * 1024;

export interface RendererHangStackFrame {
  column: number;
  functionName: string;
  line: number;
  /** 只有末两段路径，避免把用户主目录整条写进诊断。 */
  url: string;
}

export interface RendererHangStackCapture {
  frames: RendererHangStackFrame[];
  ok: boolean;
  reason?: "detached" | "pause-failed" | "timeout" | "unavailable";
}

export interface RendererMemorySample {
  backingStorageMb: number | null;
  domNodes: number | null;
  eventListeners: number | null;
  jsHeapTotalMb: number | null;
  jsHeapUsedMb: number | null;
  sampledAt: number;
}

export interface RendererHangDebugger {
  captureStack(options?: {
    timeoutMs?: number;
  }): Promise<RendererHangStackCapture>;
  dispose(): void;
  getLastMemorySample(): RendererMemorySample | null;
}

type DebuggerSession = Pick<
  WebContents["debugger"],
  "attach" | "detach" | "isAttached" | "on" | "removeListener" | "sendCommand"
>;

export interface AttachRendererHangDebuggerOptions {
  log?: Pick<Logger, "warn">;
  memorySampleIntervalMs?: number;
  now?: () => number;
  session?: DebuggerSession;
}

interface RawPausedFrame {
  functionName?: unknown;
  location?: {
    columnNumber?: unknown;
    lineNumber?: unknown;
  };
  url?: unknown;
}

const handles = new WeakMap<object, RendererHangDebugger>();

/** Attach 是幂等的；同一 WebContents 复用同一个 handle。 */
export function attachRendererHangDebugger(
  webContents: WebContents,
  options: AttachRendererHangDebuggerOptions = {}
): RendererHangDebugger | null {
  const existing = handles.get(webContents);
  if (existing) {
    return existing;
  }
  let session: DebuggerSession;
  try {
    session = options.session ?? webContents.debugger;
  } catch {
    return null;
  }
  if (!session) {
    return null;
  }
  try {
    if (!session.isAttached()) {
      session.attach(DEBUGGER_PROTOCOL_VERSION);
    }
  } catch (error) {
    options.log?.warn("renderer-hang-debugger-attach-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const now = options.now ?? Date.now;
  let disposed = false;
  let enabled: Promise<boolean> | null = null;
  let enableFailureLogged = false;
  let lastMemorySample: RendererMemorySample | null = null;
  let sampling = false;

  const ensureEnabled = (): Promise<boolean> => {
    if (disposed) {
      return Promise.resolve(false);
    }
    if (enabled) {
      return enabled;
    }
    enabled = session.sendCommand("Debugger.enable").then(
      () => true,
      (error) => {
        // 让下一次 capture 重试，而不是永久判定不可用。
        enabled = null;
        if (!enableFailureLogged) {
          enableFailureLogged = true;
          options.log?.warn("renderer-hang-debugger-enable-failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
    );
    return enabled;
  };

  /**
   * 导航/进程崩溃后 DevTools agent 会换一个 V8 会话，已 enable 的域需要
   * 重新下发。`Debugger.enable` 幂等。
   */
  const onDidFinishLoad = (): void => {
    enabled = null;
    enableFailureLogged = false;
    ensureEnabled().catch(() => undefined);
  };
  try {
    webContents.on("did-finish-load", onDidFinishLoad);
  } catch {
    // 测试替身 / 已销毁的 WebContents：没有事件也照样能抓。
  }

  const sampleMemory = async (): Promise<void> => {
    if (disposed || sampling || !isSessionAttached(session)) {
      return;
    }
    sampling = true;
    try {
      const [heap, dom] = await Promise.all([
        session.sendCommand("Runtime.getHeapUsage").catch(() => null),
        session.sendCommand("Memory.getDOMCounters").catch(() => null),
      ]);
      const heapRecord = asRecord(heap);
      const domRecord = asRecord(dom);
      if (heapRecord === null && domRecord === null) {
        return;
      }
      lastMemorySample = {
        backingStorageMb: toMb(heapRecord?.backingStorageSize),
        domNodes: toCount(domRecord?.nodes),
        eventListeners: toCount(domRecord?.jsEventListeners),
        jsHeapTotalMb: toMb(heapRecord?.totalSize),
        jsHeapUsedMb: toMb(heapRecord?.usedSize),
        sampledAt: now(),
      };
    } finally {
      sampling = false;
    }
  };

  const memoryTimer = setInterval(() => {
    sampleMemory().catch(() => undefined);
  }, options.memorySampleIntervalMs ?? DEFAULT_MEMORY_SAMPLE_INTERVAL_MS);
  // 不阻止进程退出。
  (memoryTimer as { unref?: () => void }).unref?.();

  const handle: RendererHangDebugger = {
    async captureStack(captureOptions = {}) {
      const timeoutMs =
        captureOptions.timeoutMs ?? RENDERER_HANG_STACK_PAUSE_TIMEOUT_MS;
      if (disposed || !isSessionAttached(session)) {
        return { frames: [], ok: false, reason: "detached" };
      }
      const didEnable = await withTimeout(ensureEnabled(), timeoutMs);
      if (didEnable !== true) {
        return { frames: [], ok: false, reason: "timeout" };
      }
      const paused = waitForPaused(session);
      try {
        const pauseAccepted = await withTimeout(
          session.sendCommand("Debugger.pause").then(
            () => true,
            () => false
          ),
          timeoutMs
        );
        if (pauseAccepted !== true) {
          return { frames: [], ok: false, reason: "pause-failed" };
        }
        const frames = await paused.wait(timeoutMs);
        if (frames === null) {
          // 渲染器其实空闲时 pause 会挂成「下一条语句暂停」；disable 才能
          // 确保不会在恢复后突然冻住。下次 capture 会重新 enable。
          paused.cancel();
          enabled = null;
          session.sendCommand("Debugger.disable").catch(() => undefined);
          return { frames: [], ok: false, reason: "timeout" };
        }
        return {
          frames: capHangStackFrames(frames.map(toStackFrame)),
          ok: true,
        };
      } finally {
        paused.cancel();
        // 无论最终是否 force-crash，都不留一个暂停中的 renderer。
        session.sendCommand("Debugger.resume").catch(() => undefined);
      }
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearInterval(memoryTimer);
      try {
        webContents.removeListener("did-finish-load", onDidFinishLoad);
      } catch {
        // ignore
      }
      try {
        if (session.isAttached()) {
          session.detach();
        }
      } catch {
        // 进程已经没了
      }
      handles.delete(webContents);
    },

    getLastMemorySample() {
      return lastMemorySample;
    },
  };
  handles.set(webContents, handle);
  // 启动即 enable，让卡死时的 pause 只走中断路径。
  ensureEnabled().catch(() => undefined);
  if (lastMemorySample === null) {
    sampleMemory().catch(() => undefined);
  }
  return handle;
}

export function getRendererHangDebugger(
  webContents: object
): RendererHangDebugger | null {
  return handles.get(webContents) ?? null;
}

export function disposeRendererHangDebugger(webContents: object): void {
  handles.get(webContents)?.dispose();
}

export async function captureRendererHangStack(
  webContents: object,
  options?: { timeoutMs?: number }
): Promise<RendererHangStackCapture> {
  const handle = handles.get(webContents);
  if (!handle) {
    return { frames: [], ok: false, reason: "unavailable" };
  }
  return await handle.captureStack(options);
}

function isSessionAttached(session: DebuggerSession): boolean {
  try {
    return session.isAttached();
  } catch {
    return false;
  }
}

function waitForPaused(session: DebuggerSession): {
  cancel: () => void;
  wait(timeoutMs: number): Promise<RawPausedFrame[] | null>;
} {
  let settle: ((frames: RawPausedFrame[] | null) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<RawPausedFrame[] | null>((resolve) => {
    settle = resolve;
  });
  const onMessage = (
    _event: unknown,
    method: string,
    params: { callFrames?: unknown }
  ): void => {
    if (method !== "Debugger.paused") {
      return;
    }
    cleanup();
    const frames = Array.isArray(params.callFrames)
      ? (params.callFrames as RawPausedFrame[])
      : [];
    settle?.(frames);
  };
  const cleanup = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      session.removeListener("message", onMessage);
    } catch {
      // ignore
    }
  };
  try {
    session.on("message", onMessage);
  } catch {
    cleanup();
  }
  return {
    cancel: cleanup,
    wait(timeoutMs) {
      return new Promise<RawPausedFrame[] | null>((resolve) => {
        timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutMs);
        promise.then(resolve);
      });
    },
  };
}

function toStackFrame(frame: RawPausedFrame): RendererHangStackFrame {
  const name =
    typeof frame.functionName === "string" && frame.functionName.length > 0
      ? frame.functionName
      : "(anonymous)";
  const rawUrl = typeof frame.url === "string" ? frame.url : "";
  return {
    column: toPositiveInt(frame.location?.columnNumber) + 1,
    functionName: name.slice(0, MAX_FRAME_NAME_CHARS),
    line: toPositiveInt(frame.location?.lineNumber) + 1,
    url: describeFrameUrl(rawUrl),
  };
}

function describeFrameUrl(raw: string): string {
  if (raw.length === 0) {
    return "";
  }
  if (raw.startsWith("data:")) {
    return "<inline>";
  }
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const tail = segments.slice(-2).join("/");
    return (tail || parsed.hostname || raw).slice(0, MAX_FRAME_URL_CHARS);
  } catch {
    const segments = raw.split(/[\\/]/u).filter(Boolean);
    return segments.slice(-2).join("/").slice(0, MAX_FRAME_URL_CHARS);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function toMb(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round((value / MB) * 10) / 10
    : null;
}

function toCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function toPositiveInt(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** 帧数上限；保留最内层（真正卡住的函数）。 */
export function capHangStackFrames(
  frames: readonly RendererHangStackFrame[]
): RendererHangStackFrame[] {
  return frames.slice(0, MAX_STACK_FRAMES);
}
