/**
 * Product data for canvases comes in two flavors:
 * - KPI hooks below (`useActivityOverview` / `useSystemResources` /
 *   `useCostOverview`) — read-only structured snapshots of host state.
 * - Everything else is Host API (`import { host, useHostSnapshot } from
 *   "pier/host"`), not ad-hoc data hooks. Bind commands, events, and
 *   snapshots on the canvas and compose `Item` / `Table` / `DataChart`
 *   yourself.
 *
 * Adjacent files stay `useCanvasFile` from `./files.js`.
 */

/** Window-scoped activity counters (see `useActivityOverview`). */
export interface CanvasActivityCounts {
  /** Active list row count. */
  inProgress: number;
  /** Agent waiting/error + task blocked/failed rows. */
  needsYou: number;
  /** Agent processing/tool + active task runs. */
  running: number;
}

/** One active row in the activity overview list. */
export interface CanvasActivityRow {
  kind: "agent" | "shell" | "task";
  panelId: string;
  updatedAt: number;
}

export interface CanvasActivityOverview {
  counts: CanvasActivityCounts;
  /** Non-idle foreground activities plus active tasks, newest first. */
  rows: CanvasActivityRow[];
}

/** CPU trend sample. */
export interface CanvasResourceHistoryPoint {
  ts: number;
  value: number;
}

export interface CanvasSystemResources {
  cpuHistory: readonly CanvasResourceHistoryPoint[];
  error: string | null;
  /** Latest related-process resource snapshot; null until first poll. */
  snapshot: unknown;
  status: "error" | "loading" | "ready";
}

export interface CanvasCostOverview {
  /** Cross-plugin usage aggregate; null until the first bridge read. */
  snapshot: unknown;
  status: "error" | "loading" | "ready";
}

/** Window-scoped activity overview: counters plus active rows. */
export const useActivityOverview: () => CanvasActivityOverview;

/** Related-process CPU trend and latest resource snapshot. */
export const useSystemResources: () => CanvasSystemResources;

/** Cross-plugin cost aggregate. Refresh with `host.invoke({ type: "usageData.refresh" })`. */
export const useCostOverview: () => CanvasCostOverview;
