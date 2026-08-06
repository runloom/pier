import { randomUUID } from "node:crypto";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { getDiagnosticsDir } from "../diagnostics/app.ts";
import type { AppWindow } from "./app-window.ts";

const log = createLogger("renderer.failure");

/** Link unresponsive → force-crash → gone within this window. */
export const RENDERER_FORCE_CRASH_LINK_MS = 10_000;

export interface RendererProcessGoneDetails {
  exitCode: number;
  reason: string;
}

export interface RendererFailureIncident {
  forceCrashed: boolean;
  hadUnresponsive: boolean;
  incidentId: string;
}

export interface RendererFailureDiagnosticSnapshot {
  arch: string;
  chrome: string | undefined;
  diagnosticsDir: string | null;
  electron: string | undefined;
  isDev: boolean;
  /** Main (Node) process — not the crashed renderer. */
  mainHeapUsedMb: number | null;
  mainPid: number;
  mainRssMb: number | null;
  platform: string;
  processCount: number | null;
  /** Counts by Electron process type (Browser / Tab / GPU / …). */
  processTypes: Record<string, number> | null;
  /** OS pid of the renderer process when available. */
  rendererOsPid: number | null;
  /** Chromium internal renderer pid when available. */
  rendererPid: number | null;
  uptimeSec: number;
  /** Origin + pathname only (query/hash stripped). */
  url: string | null;
  visible: boolean;
  windowId: number;
}

export function createRendererFailureIncidentId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

/**
 * Log-safe URL: drop query/hash so tokens never land in diagnostics JSONL.
 * `data:` bodies are replaced with a placeholder.
 */
export function sanitizeRendererFailureUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("data:")) {
    return "data:...";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "file:") {
      return `file://${parsed.pathname}`.slice(0, 500);
    }
    const cleaned = `${parsed.origin}${parsed.pathname}`;
    if (cleaned.length > 0 && cleaned !== "null") {
      return cleaned.slice(0, 500);
    }
    return (trimmed.split(/[?#]/, 1)[0] ?? trimmed).slice(0, 500);
  } catch {
    return (trimmed.split(/[?#]/, 1)[0] ?? trimmed).slice(0, 500);
  }
}

function safeUrl(window: AppWindow): string | null {
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return null;
    }
    const url = window.webContents.getURL();
    return typeof url === "string" ? sanitizeRendererFailureUrl(url) : null;
  } catch {
    return null;
  }
}

function safeDiagnosticsDir(): string | null {
  try {
    return getDiagnosticsDir();
  } catch {
    try {
      return `${app.getPath("userData")}/diagnostics`;
    } catch {
      return null;
    }
  }
}

function mbFromBytes(bytes: number | undefined): number | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    return null;
  }
  return Math.round(bytes / (1024 * 1024));
}

function safeMainProcessMetrics(): {
  mainHeapUsedMb: number | null;
  mainRssMb: number | null;
  processCount: number | null;
  processTypes: Record<string, number> | null;
} {
  let mainRssMb: number | null = null;
  let mainHeapUsedMb: number | null = null;
  try {
    const mem = process.memoryUsage();
    mainRssMb = mbFromBytes(mem.rss);
    mainHeapUsedMb = mbFromBytes(mem.heapUsed);
  } catch {
    // ignore
  }
  let processCount: number | null = null;
  let processTypes: Record<string, number> | null = null;
  try {
    if (typeof app.getAppMetrics === "function") {
      const metrics = app.getAppMetrics();
      processCount = metrics.length;
      const types: Record<string, number> = {};
      for (const metric of metrics) {
        const type =
          typeof metric.type === "string" && metric.type.length > 0
            ? metric.type
            : "unknown";
        types[type] = (types[type] ?? 0) + 1;
      }
      processTypes = types;
    }
  } catch {
    // ignore
  }
  return { mainHeapUsedMb, mainRssMb, processCount, processTypes };
}

function safeRendererPids(window: AppWindow): {
  rendererOsPid: number | null;
  rendererPid: number | null;
} {
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return { rendererOsPid: null, rendererPid: null };
    }
    const wc = window.webContents as WebContentsPidAccess;
    const rendererOsPid =
      typeof wc.getOSProcessId === "function" ? wc.getOSProcessId() : null;
    const rendererPid =
      typeof wc.getProcessId === "function" ? wc.getProcessId() : null;
    return {
      rendererOsPid:
        typeof rendererOsPid === "number" && Number.isFinite(rendererOsPid)
          ? rendererOsPid
          : null,
      rendererPid:
        typeof rendererPid === "number" && Number.isFinite(rendererPid)
          ? rendererPid
          : null,
    };
  } catch {
    return { rendererOsPid: null, rendererPid: null };
  }
}

/** Minimal surface for Electron pid helpers (not always on typings in tests). */
interface WebContentsPidAccess {
  getOSProcessId?: () => number;
  getProcessId?: () => number;
}

export function collectRendererFailureDiagnostics(input: {
  isContentVisible: () => boolean;
  window: AppWindow;
}): RendererFailureDiagnosticSnapshot {
  const metrics = safeMainProcessMetrics();
  const rendererPids = safeRendererPids(input.window);
  let visible = false;
  try {
    visible = input.isContentVisible();
  } catch {
    visible = false;
  }
  return {
    arch: process.arch,
    chrome: process.versions.chrome,
    diagnosticsDir: safeDiagnosticsDir(),
    electron: process.versions.electron,
    isDev: Boolean(process.env.ELECTRON_RENDERER_URL),
    mainHeapUsedMb: metrics.mainHeapUsedMb,
    mainPid: process.pid,
    mainRssMb: metrics.mainRssMb,
    platform: process.platform,
    processCount: metrics.processCount,
    processTypes: metrics.processTypes,
    rendererOsPid: rendererPids.rendererOsPid,
    rendererPid: rendererPids.rendererPid,
    uptimeSec: Math.round(process.uptime()),
    url: safeUrl(input.window),
    visible,
    windowId: input.window.id,
  };
}

/**
 * User-facing technical detail for recovery page / native dialog.
 * Keep the first line as the short Chromium reason so logs/tests can still
 * match `crashed (exit N)`.
 */
export function formatRendererCrashDetail(input: {
  diagnosticsDir: string | null;
  exitCode: number;
  forceCrashed: boolean;
  incidentId: string;
  reason: string;
}): string {
  const lines = [
    `${input.reason} (exit ${input.exitCode})`,
    `incident: ${input.incidentId}`,
  ];
  if (input.forceCrashed) {
    lines.push("cause: unresponsive-force-crash");
  }
  if (input.diagnosticsDir) {
    lines.push(`logs: ${input.diagnosticsDir}`);
  }
  return lines.join("\n");
}

export function rendererFailureLogCtx(
  incident: RendererFailureIncident,
  snapshot: RendererFailureDiagnosticSnapshot,
  gone?: RendererProcessGoneDetails
): Record<string, unknown> {
  return {
    arch: snapshot.arch,
    chrome: snapshot.chrome,
    diagnosticsDir: snapshot.diagnosticsDir,
    electron: snapshot.electron,
    ...(gone ? { exitCode: gone.exitCode, reason: gone.reason } : {}),
    forceCrashed: incident.forceCrashed,
    hadUnresponsive: incident.hadUnresponsive,
    incidentId: incident.incidentId,
    isDev: snapshot.isDev,
    mainHeapUsedMb: snapshot.mainHeapUsedMb,
    mainPid: snapshot.mainPid,
    mainRssMb: snapshot.mainRssMb,
    platform: snapshot.platform,
    processCount: snapshot.processCount,
    processTypes: snapshot.processTypes,
    rendererOsPid: snapshot.rendererOsPid,
    rendererPid: snapshot.rendererPid,
    uptimeSec: snapshot.uptimeSec,
    url: snapshot.url,
    visible: snapshot.visible,
    windowId: snapshot.windowId,
  };
}

export interface RendererFailureIncidentTracker {
  beginUnresponsive(): RendererFailureIncident;
  clearPendingForceCrash(): void;
  markForceCrashAttempt(incidentId: string): void;
  resolveForProcessGone(): RendererFailureIncident;
}

export function createRendererFailureIncidentTracker(
  linkMs: number = RENDERER_FORCE_CRASH_LINK_MS
): RendererFailureIncidentTracker {
  let lastUnresponsiveAt = 0;
  let pendingForceCrash: { at: number; incidentId: string } | null = null;

  return {
    beginUnresponsive() {
      const incidentId = createRendererFailureIncidentId();
      lastUnresponsiveAt = Date.now();
      return {
        forceCrashed: false,
        hadUnresponsive: true,
        incidentId,
      };
    },
    clearPendingForceCrash() {
      pendingForceCrash = null;
    },
    markForceCrashAttempt(incidentId: string) {
      pendingForceCrash = { at: Date.now(), incidentId };
    },
    resolveForProcessGone() {
      const now = Date.now();
      const linked =
        pendingForceCrash && now - pendingForceCrash.at <= linkMs
          ? pendingForceCrash
          : null;
      pendingForceCrash = null;
      const hadUnresponsive =
        lastUnresponsiveAt > 0 && now - lastUnresponsiveAt <= linkMs;
      if (linked) {
        return {
          forceCrashed: true,
          hadUnresponsive: true,
          incidentId: linked.incidentId,
        };
      }
      return {
        forceCrashed: false,
        hadUnresponsive,
        incidentId: createRendererFailureIncidentId(),
      };
    },
  };
}

function shouldLogProcessGoneAsError(
  gone: RendererProcessGoneDetails,
  isQuitting: boolean,
  windowDestroyed: boolean
): boolean {
  if (isQuitting || windowDestroyed) {
    return false;
  }
  return gone.reason !== "clean-exit";
}

export function logRendererProcessGone(input: {
  gone: RendererProcessGoneDetails;
  incident: RendererFailureIncident;
  isQuitting: boolean;
  snapshot: RendererFailureDiagnosticSnapshot;
  windowDestroyed: boolean;
}): void {
  const ctx = {
    ...rendererFailureLogCtx(input.incident, input.snapshot, input.gone),
    quitting: input.isQuitting,
    windowDestroyed: input.windowDestroyed,
  };

  if (
    !shouldLogProcessGoneAsError(
      input.gone,
      input.isQuitting,
      input.windowDestroyed
    )
  ) {
    if (input.gone.reason === "clean-exit") {
      log.info("render-process-clean-exit", ctx);
    } else {
      log.info("render-process-gone-ignored", ctx);
    }
    return;
  }

  log.error("render-process-gone", ctx);
}
