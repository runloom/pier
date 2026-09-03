import { app, webContents } from "electron";
import {
  findAppWindowByWebContents,
  findInternalWindowId,
} from "../windows/identity.ts";
import {
  buildProcessMemorySample,
  installProcessMemorySampler,
  type MemorySampleMetricInput,
  type ProcessMemorySample,
} from "./memory-sampler.ts";

/**
 * Renderer label for the trail: internal window id for app windows, otherwise
 * the page origin only (hidden helper windows such as the grok fetch window).
 * Paths / queries never reach the log.
 */
function describeRendererPid(pid: number): string | null {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) {
      continue;
    }
    let osPid: number;
    try {
      osPid = contents.getOSProcessId();
    } catch {
      continue;
    }
    if (osPid !== pid) {
      continue;
    }
    const window = findAppWindowByWebContents(contents);
    if (window) {
      return findInternalWindowId(window) ?? `window:${window.id}`;
    }
    try {
      const url = new URL(contents.getURL());
      return url.origin === "null" ? url.protocol : url.origin;
    } catch {
      return contents.getType();
    }
  }
  return null;
}

export function collectElectronProcessMemorySample(): ProcessMemorySample {
  const metrics = app.getAppMetrics() as readonly MemorySampleMetricInput[];
  return buildProcessMemorySample({
    describeRendererPid,
    mainUsage: process.memoryUsage(),
    metrics,
  });
}

let dispose: (() => void) | null = null;

/** Hourly process-memory trail into the diagnostics JSONL. Idempotent. */
export function installProcessMemoryTrail(): void {
  if (dispose) {
    return;
  }
  dispose = installProcessMemorySampler({
    collect: collectElectronProcessMemorySample,
  });
  app.once("will-quit", () => {
    dispose?.();
    dispose = null;
  });
}
