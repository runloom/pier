import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";

export type NodeGraphDirection = "left-to-right" | "top-to-bottom";
export type NodeGraphTone =
  | "danger"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";

export interface NodeGraphNode {
  id: string;
  meta?: string;
  position?: { x: number; y: number };
  title: string;
  tone?: NodeGraphTone;
}

export interface NodeGraphEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

export type GraphNodeData = Record<string, unknown> &
  NodeGraphNode & {
    dimmed: boolean;
  };

/** Card width — wide enough that typical labels wrap instead of ellipsis. */
export const NODE_WIDTH = 220;
/** Minimum card height (short title + meta row). */
export const NODE_MIN_HEIGHT = 68;
/** @deprecated Prefer NODE_MIN_HEIGHT; kept for layout callers. */
export const NODE_HEIGHT = NODE_MIN_HEIGHT;
export const MIN_ZOOM = 0.12;
/** Stage (fullscreen) allows closer inspection than fit-at-most-1. */
export const STAGE_MAX_ZOOM = 4;
/** Inline surface height floor / ceiling so graphs show fully without dominating. */
export const INLINE_SURFACE_MIN_HEIGHT = 240;
export const INLINE_SURFACE_MAX_HEIGHT = 720;
export const INLINE_SURFACE_PAD = 56;
export const FIT_VIEW_OPTIONS = {
  maxZoom: 1,
  minZoom: MIN_ZOOM,
  padding: 0.18,
};
/** Fit never upscales past 1 (match image “Fit to window”). */
export const STAGE_FIT_VIEW_OPTIONS = {
  maxZoom: 1,
  minZoom: MIN_ZOOM,
  // Extra air around the graph; host also pads for title / zoom chrome.
  padding: 0.16,
};

const NODE_PAD_X = 24;
const TITLE_LINE_HEIGHT = 20;
const HEADER_LINE_HEIGHT = 18;
const STACK_GAP = 6;
const NODE_PAD_Y = 28;
/** Latin/mono average at text-sm; CJK is wider — counted separately. */
const LATIN_GLYPH_PX = 11;
const CJK_GLYPH_PX = 14;
const SAFETY_LINES = 0.35;

const CJK_CODE_POINT =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

function measureTextWidth(text: string, glyphPx: number): number {
  let width = 0;
  for (const char of text) {
    width += CJK_CODE_POINT.test(char) ? CJK_GLYPH_PX : glyphPx;
  }
  return width;
}

function estimateWrappedLines(text: string, contentWidth: number): number {
  if (!text) {
    return 1;
  }
  const width = measureTextWidth(text, LATIN_GLYPH_PX);
  return Math.max(1, Math.ceil(width / contentWidth + SAFETY_LINES));
}

/**
 * Layout height for full (non-truncated) title + meta. Used by ELK and the
 * inline surface so wrapped labels do not overlap.
 */
export function estimateNodeHeight(node: NodeGraphNode): number {
  const contentWidth = NODE_WIDTH - NODE_PAD_X;
  const titleLines = estimateWrappedLines(node.title, contentWidth);
  // Header is flex-wrap: status dot + id, meta may sit on the same row.
  const idWidth = measureTextWidth(node.id, LATIN_GLYPH_PX) + 12;
  const metaWidth = node.meta ? measureTextWidth(node.meta, LATIN_GLYPH_PX) : 0;
  let headerLines = 1;
  if (node.meta) {
    if (idWidth + 8 + metaWidth <= contentWidth) {
      headerLines = 1;
    } else {
      headerLines =
        estimateWrappedLines(node.id, contentWidth - 12) +
        estimateWrappedLines(node.meta, contentWidth);
    }
  }

  return Math.max(
    NODE_MIN_HEIGHT,
    headerLines * HEADER_LINE_HEIGHT +
      STACK_GAP +
      titleLines * TITLE_LINE_HEIGHT +
      NODE_PAD_Y
  );
}

/**
 * Content-box height for the inline graph surface so fitView can show the full
 * layout at a readable scale (clamped).
 */
export function inlineSurfaceHeightForLayout(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  nodes: readonly NodeGraphNode[]
): number {
  if (nodes.length === 0) {
    return INLINE_SURFACE_MIN_HEIGHT;
  }
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const position = node.position ?? positions.get(node.id) ?? { x: 0, y: 0 };
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y + estimateNodeHeight(node));
  }
  if (!(Number.isFinite(minY) && Number.isFinite(maxY))) {
    return INLINE_SURFACE_MIN_HEIGHT;
  }
  const content = maxY - minY + INLINE_SURFACE_PAD * 2;
  return Math.min(
    INLINE_SURFACE_MAX_HEIGHT,
    Math.max(INLINE_SURFACE_MIN_HEIGHT, Math.ceil(content))
  );
}

export const TONE_CLASS: Record<NodeGraphTone, string> = {
  danger: "bg-status-danger-fg",
  done: "bg-status-done-fg",
  info: "bg-status-info-fg",
  muted: "bg-muted-foreground",
  success: "bg-status-success-fg",
  warning: "bg-status-warning-fg",
};

const elk = new ELK();

export function initialFlowNodes(
  nodes: readonly NodeGraphNode[],
  keyboardSelectable: boolean
): Node<GraphNodeData>[] {
  return nodes.map((node) => {
    const height = estimateNodeHeight(node);
    return {
      ariaLabel: `${node.id} ${node.title}`,
      data: { ...node, dimmed: false },
      draggable: false,
      focusable: keyboardSelectable,
      height,
      id: node.id,
      position: node.position ?? { x: 0, y: 0 },
      selectable: true,
      type: "pier",
      width: NODE_WIDTH,
    };
  });
}

export function initialFlowEdges(edges: readonly NodeGraphEdge[]): Edge[] {
  return edges.map((edge, index) => ({
    animated: false,
    id: edge.id ?? `${edge.source}-${edge.target}-${index}`,
    label: edge.label,
    markerEnd: { type: "arrowclosed" },
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
  }));
}

export async function layoutNodes(
  nodes: readonly NodeGraphNode[],
  edges: readonly NodeGraphEdge[],
  direction: NodeGraphDirection
): Promise<Map<string, { x: number; y: number }>> {
  const result = await elk.layout({
    children: nodes.map((node) => ({
      height: estimateNodeHeight(node),
      id: node.id,
      width: NODE_WIDTH,
    })),
    edges: edges.map((edge, index) => ({
      id: edge.id ?? `${edge.source}-${edge.target}-${index}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "left-to-right" ? "RIGHT" : "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
      "elk.spacing.nodeNode": "28",
    },
  });
  return new Map(
    (result.children ?? []).map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ])
  );
}
