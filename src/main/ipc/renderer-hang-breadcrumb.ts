import {
  type RendererHangBreadcrumb,
  rendererHangBreadcrumbSchema,
  type StoredRendererHangBreadcrumb,
  sanitizeHangBreadcrumbFields,
} from "@shared/contracts/diagnostics/hang-breadcrumb.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app, type IpcMain, type WebContents } from "electron";
import { findAppWindowByWebContents } from "../windows/identity.ts";
import {
  type AppMetricLike,
  findRendererProcessMetric,
  type RendererProcessMetricSnapshot,
} from "../windows/renderer-hang-capture.ts";
import { rememberHangBreadcrumb } from "./renderer-hang-breadcrumb-store.ts";

export {
  __resetHangBreadcrumbsForTests,
  clearHangBreadcrumbsForWindow,
  getHangBreadcrumbsForDiagnostics,
  getHangBreadcrumbsForWindow,
  rememberHangBreadcrumb,
} from "./renderer-hang-breadcrumb-store.ts";

const log = createLogger("renderer.hang-breadcrumb");

const MAX_BATCH_ITEMS = 32;

/**
 * Parse one crumb or a batch item-by-item so a single invalid entry cannot
 * wipe a full flush of valid trail. Clamp path/detail before parse.
 */
export function normalizeHangBreadcrumbBatch(
  raw: unknown
): RendererHangBreadcrumb[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw.slice(0, MAX_BATCH_ITEMS)
    : [raw];
  const out: RendererHangBreadcrumb[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    // Pre-clamp known string fields so oversize path does not drop the crumb.
    const loose = item as RendererHangBreadcrumb;
    const clamped = sanitizeHangBreadcrumbFields(loose);
    const parsed = rendererHangBreadcrumbSchema.safeParse(clamped);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}

/** 落盘前给每条记录补上的 renderer 侧真实指标。 */
export interface RendererMetricEnrichment {
  cpuPercent: number | null;
  workingSetMb: number | null;
}

export function readRendererMetricForSender(
  sender: Pick<WebContents, "getOSProcessId">,
  metrics: readonly AppMetricLike[] = app.getAppMetrics()
): RendererMetricEnrichment | null {
  let pid: number;
  try {
    pid = sender.getOSProcessId();
  } catch {
    return null;
  }
  if (pid <= 0) {
    return null;
  }
  const metric: RendererProcessMetricSnapshot | null =
    findRendererProcessMetric(metrics, pid);
  if (metric === null) {
    return null;
  }
  return {
    cpuPercent: metric.cpuPercent,
    workingSetMb: metric.workingSetMb,
  };
}

function enrich(
  crumb: RendererHangBreadcrumb,
  metric: RendererMetricEnrichment | null
): RendererHangBreadcrumb {
  if (metric === null) {
    return crumb;
  }
  return {
    ...crumb,
    ...(metric.cpuPercent === null
      ? {}
      : { rendererCpuPercent: metric.cpuPercent }),
    ...(metric.workingSetMb === null
      ? {}
      : { rendererWorkingSetMb: metric.workingSetMb }),
  };
}

/**
 * Renderer hang trail: validate batch, ring-buffer, one JSONL line per flush.
 * Window identity is always taken from event.sender (never from payload).
 *
 * 每条记录附带 main 侧读到的 renderer CPU 与工作集：`performance.memory`
 * 在未开启 `--enable-precise-memory-info` 时是恒定占位值，renderer 自己
 * 报的内存不可信。
 */
export function registerRendererHangBreadcrumbIpc(
  ipcMain: IpcMain,
  deps: {
    readMetric?: (
      sender: Pick<WebContents, "getOSProcessId">
    ) => RendererMetricEnrichment | null;
  } = {}
): void {
  const readMetric =
    deps.readMetric ?? ((sender) => readRendererMetricForSender(sender));

  ipcMain.on(PIER.RENDERER_HANG_BREADCRUMB, (event, raw) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      return;
    }
    const crumbs = normalizeHangBreadcrumbBatch(raw);
    if (crumbs.length === 0) {
      log.warn("Dropped hang breadcrumb", {
        reason: "invalid-payload",
        senderId: event.sender.id,
      });
      return;
    }
    let metric: RendererMetricEnrichment | null = null;
    try {
      metric = readMetric(event.sender);
    } catch {
      // Metrics are best-effort; the trail still gets written.
    }
    const receivedAt = Date.now();
    const stored: StoredRendererHangBreadcrumb[] = crumbs.map((crumb) => ({
      ...enrich(crumb, metric),
      receivedAt,
    }));
    for (const crumb of stored) {
      rememberHangBreadcrumb(win.id, crumb);
    }
    // Single log line per flush keeps disk I/O low under continuous trail.
    log.info("renderer-hang-trail", {
      browserWindowId: win.id,
      count: stored.length,
      crumbs: stored,
    });
  });
}
