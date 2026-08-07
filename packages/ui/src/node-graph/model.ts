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

export const NODE_WIDTH = 164;
export const NODE_HEIGHT = 68;
export const MIN_ZOOM = 0.12;
export const FIT_VIEW_OPTIONS = {
  maxZoom: 1,
  minZoom: MIN_ZOOM,
  padding: 0.18,
};

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
  return nodes.map((node) => ({
    ariaLabel: `${node.id} ${node.title}`,
    data: { ...node, dimmed: false },
    draggable: false,
    focusable: keyboardSelectable,
    id: node.id,
    position: node.position ?? { x: 0, y: 0 },
    selectable: true,
    type: "pier",
  }));
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
      height: NODE_HEIGHT,
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
