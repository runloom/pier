import type { RendererHangBreadcrumb } from "@shared/contracts/diagnostics/hang-breadcrumb.ts";
import {
  RENDERER_HANG_BREADCRUMB_IMMEDIATE_KINDS,
  sanitizeHangBreadcrumbFields,
} from "@shared/contracts/diagnostics/hang-breadcrumb.ts";
import {
  flushPendingLongTasks,
  installLongTaskObserver,
} from "./long-task-observer.ts";

/**
 * Always-on hang trail (low overhead):
 * - O(1) local ring + consecutive-dedup (never blocks UI)
 * - batched IPC flush (default 1s); high-signal kinds flush immediately
 * - heartbeats skip consecutive-dedupe so idle liveness keeps ticking
 * - long-task evidence comes from `PerformanceObserver("longtask")`
 * - main writes diagnostics JSONL (14d retention) + per-window ring
 */

const LOCAL_RING_MAX = 64;
const PENDING_MAX = 32;
const FLUSH_MS = 1000;
const HEARTBEAT_MS = 30_000;

const localRing: Array<RendererHangBreadcrumb & { at: number }> = [];
const pending: RendererHangBreadcrumb[] = [];
let lastDedupeKey = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let longTaskDispose: (() => void) | null = null;
let installed = false;
let heartbeatSeq = 0;

/**
 * 心跳只报「还活着」。内存证据不在这里取：
 * `performance.memory.usedJSHeapSize` 在未开启 `--enable-precise-memory-info`
 * 时是恒定占位值（实测持续分配 1.3GB 仍不变化），据此算出的增量会让复盘
 * 误判成「内存没涨」。真实的工作集与 CPU 由 main 侧在落盘前挂到每一条
 * breadcrumb 上（`rendererWorkingSetMb` / `rendererCpuPercent`）。
 */
function dedupeKey(payload: RendererHangBreadcrumb): string {
  return [
    payload.kind,
    payload.phase ?? "",
    payload.detail ?? "",
    payload.commandId ?? "",
    payload.panelId ?? "",
    payload.activePanelComponent ?? "",
    payload.path ?? "",
    payload.mode ?? "",
    payload.dirty === undefined ? "" : String(payload.dirty),
    payload.diskConflict === undefined ? "" : String(payload.diskConflict),
  ].join("|");
}

function sendBatch(batch: RendererHangBreadcrumb[]): void {
  if (batch.length === 0) {
    return;
  }
  try {
    window.pier?.diagnostics?.hangBreadcrumb?.(
      batch.length === 1 ? batch[0]! : batch
    );
  } catch {
    // never throw
  }
}

function flushPending(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.length === 0) {
    return;
  }
  const batch = pending.splice(0, pending.length);
  sendBatch(batch);
}

function scheduleFlush(): void {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending();
  }, FLUSH_MS);
}

/**
 * Note a hang-trail breadcrumb. Safe from any UI path: never throws, never awaits.
 */
export function noteHangBreadcrumb(payload: RendererHangBreadcrumb): void {
  noteHangBreadcrumbs([payload]);
}

/**
 * Note a batch with one IPC send. 长任务一次发射可以产出好几条记录，
 * 逐条走 immediate flush 会把 main 侧 100 条的环形缓冲区灌满，
 * 反而挤掉 command / panel-close 这类真正定位卡死的线索。
 */
export function noteHangBreadcrumbs(
  payloads: readonly RendererHangBreadcrumb[]
): void {
  try {
    const accepted: RendererHangBreadcrumb[] = [];
    let immediate = false;
    for (const payload of payloads) {
      const crumb = sanitizeHangBreadcrumbFields(payload);
      // Heartbeats must not be consecutive-deduped — every tick is a new liveness
      // sample. Other kinds still collapse identical back-to-back noise.
      if (crumb.kind === "heartbeat") {
        // Reset so a later identical non-heartbeat is not blocked by heartbeat key.
        lastDedupeKey = "";
      } else {
        const key = dedupeKey(crumb);
        if (key === lastDedupeKey) {
          continue;
        }
        lastDedupeKey = key;
      }
      const at =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      while (localRing.length >= LOCAL_RING_MAX) {
        localRing.shift();
      }
      localRing.push({ ...crumb, at });
      while (pending.length >= PENDING_MAX) {
        pending.shift();
      }
      pending.push(crumb);
      accepted.push(crumb);
      if (RENDERER_HANG_BREADCRUMB_IMMEDIATE_KINDS.has(crumb.kind)) {
        immediate = true;
      }
    }
    if (accepted.length === 0) {
      return;
    }
    if (immediate) {
      flushPending();
      return;
    }
    scheduleFlush();
  } catch {
    // ignore
  }
}

/** Pair with performance.now() for start/end phases. */
export function hangBreadcrumbNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Snapshot of in-renderer trail (tests / emergency dump). */
export function readLocalHangBreadcrumbs(): readonly (RendererHangBreadcrumb & {
  at: number;
})[] {
  return localRing;
}

/**
 * Install sparse heartbeat + pagehide flush. Call once from renderer boot.
 * Heartbeat proves the trail is live without high-frequency work.
 */
export function installHangBreadcrumbRuntime(): () => void {
  if (installed) {
    return () => undefined;
  }
  installed = true;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      // 切到后台同样先吐长任务：后台 timer 会被节流，压着的证据可能
      // 要等到下一次卡死才轮到。
      flushPendingLongTasks();
      flushPending();
    }
  };
  const onPageHide = () => {
    // 先吐长任务：节流窗口里可能还压着最后一次阻塞的证据。
    flushPendingLongTasks();
    flushPending();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);

  heartbeatTimer = setInterval(() => {
    if (document.visibilityState !== "visible") {
      return;
    }
    heartbeatSeq += 1;
    // seq in detail keeps each tick distinct for logs without changing schema.
    noteHangBreadcrumb({
      detail: `alive-${heartbeatSeq}`,
      kind: "heartbeat",
      phase: "tick",
    });
  }, HEARTBEAT_MS);

  // 长任务证据：卡死前的同步阻塞只能由浏览器自己量出来。
  // 一次发射合并成一条 IPC，避免把 main 侧环形缓冲区灌满。
  longTaskDispose = installLongTaskObserver({ noteBatch: noteHangBreadcrumbs });

  // First mark so post-mortem logs show trail start after boot.
  noteHangBreadcrumb({
    kind: "mark",
    phase: "state",
    detail: "trail-installed",
  });

  return () => {
    installed = false;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    longTaskDispose?.();
    longTaskDispose = null;
    flushPending();
  };
}

export function __resetHangBreadcrumbRuntimeForTests(): void {
  lastDedupeKey = "";
  heartbeatSeq = 0;
  localRing.length = 0;
  pending.length = 0;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  longTaskDispose?.();
  longTaskDispose = null;
  installed = false;
}
