/**
 * Live DAG viewer types. Status wash uses the same `status-*` family as
 * Mermaid run marks — no hex, no architecture `kind` chrome.
 */
import type { ReactNode } from "react";

export type FlowGraphDirection = "left-to-right" | "top-to-bottom";

export type FlowGraphNodeStatus =
  | "blocked"
  | "failed"
  | "queued"
  | "ready"
  | "running"
  | "skipped"
  | "success";

export interface FlowGraphNode {
  /** Corner chip (agent name, lane, …). Display only. */
  badge?: string;
  /**
   * Reserved height (px) for `renderNodeContent`. Required when that slot
   * renders for this node so neighbors space correctly.
   */
  contentHeight?: number;
  /** Opaque payload for the canvas author; the primitive does not render it. */
  data?: unknown;
  id: string;
  label: string;
  /** Secondary line under the title. */
  meta?: string;
  status?: FlowGraphNodeStatus;
  /** Accessible name for the status glyph; defaults to the status word. */
  statusLabel?: string;
}

export interface FlowGraphEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

export interface FlowGraphPosition {
  x: number;
  y: number;
}

export type FlowGraphPositions = Record<string, FlowGraphPosition>;

/** Plane metrics handed to `renderOverlay` so marks can sit on nodes. */
export interface FlowGraphOverlayLayout {
  height: number;
  positions: FlowGraphPositions;
  width: number;
}

export type FlowGraphRenderNodeContent = (node: FlowGraphNode) => ReactNode;

export type FlowGraphRenderOverlay = (
  layout: FlowGraphOverlayLayout
) => ReactNode;

export const FLOW_GRAPH_NODE_WIDTH = 200;
export const FLOW_GRAPH_NODE_HEIGHT = 64;
export const FLOW_GRAPH_META_EXTRA = 18;
export const FLOW_GRAPH_CONTENT_GAP = 16;
export const FLOW_GRAPH_RANK_SEP = 96;
export const FLOW_GRAPH_NODE_SEP = 28;
export const FLOW_GRAPH_PADDING = 24;

/**
 * Every class name is a verbatim literal: Tailwind extracts candidates
 * statically. Status family is `destructive/warning/success/info/done`.
 */
export const FLOW_GRAPH_STATUS_SURFACE: Record<FlowGraphNodeStatus, string> = {
  blocked: "border-warning/40 bg-warning/10",
  failed: "border-destructive/40 bg-destructive/10",
  queued: "border-info/40 bg-info/10",
  ready: "border-success/40 bg-success/10",
  running: "border-info/40 bg-info/10",
  skipped: "border-border bg-muted/40",
  success: "border-success/40 bg-success/10",
};

export function flowGraphNodeSize(node: {
  contentHeight?: number | undefined;
  meta?: string | undefined;
}): { height: number; width: number } {
  const meta = node.meta ? FLOW_GRAPH_META_EXTRA : 0;
  const extra =
    node.contentHeight !== undefined && node.contentHeight > 0
      ? FLOW_GRAPH_CONTENT_GAP + node.contentHeight
      : 0;
  return {
    height: FLOW_GRAPH_NODE_HEIGHT + meta + extra,
    width: FLOW_GRAPH_NODE_WIDTH,
  };
}
