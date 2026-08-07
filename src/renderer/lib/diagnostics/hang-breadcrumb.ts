import type { RendererHangBreadcrumb } from "@shared/contracts/renderer-hang-breadcrumb.ts";
import {
  RENDERER_HANG_BREADCRUMB_IMMEDIATE_KINDS,
  sanitizeHangBreadcrumbFields,
} from "@shared/contracts/renderer-hang-breadcrumb.ts";

/**
 * Always-on hang trail (low overhead):
 * - O(1) local ring + consecutive-dedup (never blocks UI)
 * - batched IPC flush (default 1s); high-signal kinds flush immediately
 * - heartbeats skip consecutive-dedupe so idle liveness keeps ticking
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
let installed = false;
let heartbeatSeq = 0;

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
  try {
    const crumb = sanitizeHangBreadcrumbFields(payload);
    // Heartbeats must not be consecutive-deduped — every tick is a new liveness
    // sample. Other kinds still collapse identical back-to-back noise.
    if (crumb.kind === "heartbeat") {
      // Reset so a later identical non-heartbeat is not blocked by heartbeat key.
      lastDedupeKey = "";
    } else {
      const key = dedupeKey(crumb);
      if (key === lastDedupeKey) {
        return;
      }
      lastDedupeKey = key;
    }
    const at =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    localRing.push({ ...crumb, at });
    while (localRing.length > LOCAL_RING_MAX) {
      localRing.shift();
    }
    pending.push(crumb);
    while (pending.length > PENDING_MAX) {
      pending.shift();
    }
    if (RENDERER_HANG_BREADCRUMB_IMMEDIATE_KINDS.has(crumb.kind)) {
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
      flushPending();
    }
  };
  const onPageHide = () => {
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
      kind: "heartbeat",
      phase: "tick",
      detail: `alive-${heartbeatSeq}`,
    });
  }, HEARTBEAT_MS);

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
  installed = false;
}
