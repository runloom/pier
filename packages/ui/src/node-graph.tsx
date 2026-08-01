"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { useEffect, useMemo, useState } from "react";
import { cn } from "./utils.ts";

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

export interface NodeGraphProps {
  "aria-label": string;
  className?: string | undefined;
  direction?: NodeGraphDirection | undefined;
  edges: readonly NodeGraphEdge[];
  editable?: boolean | undefined;
  emptyText?: string | undefined;
  highlightedIds?: ReadonlySet<string> | undefined;
  nodes: readonly NodeGraphNode[];
  onConnectNodes?:
    | ((connection: { source: string; target: string }) => void)
    | undefined;
  onNodePositionChange?:
    | ((id: string, position: { x: number; y: number }) => void)
    | undefined;
  onSelectNode?: ((id: string) => void) | undefined;
  selectedId?: string | undefined;
}

type GraphNodeData = Record<string, unknown> &
  NodeGraphNode & {
    dimmed: boolean;
  };

const NODE_WIDTH = 164;
const NODE_HEIGHT = 68;
const elk = new ELK();
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.18 };

const TONE_CLASS: Record<NodeGraphTone, string> = {
  danger: "bg-status-danger-fg",
  done: "bg-status-done-fg",
  info: "bg-status-info-fg",
  muted: "bg-muted-foreground",
  success: "bg-status-success-fg",
  warning: "bg-status-warning-fg",
};

function GraphNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const tone = data.tone ?? "muted";
  return (
    <div
      className={cn(
        "flex h-[68px] w-[164px] flex-col justify-center gap-1.5 rounded-md border bg-card px-3 text-left text-card-foreground shadow-sm transition-[border-color,box-shadow,opacity,transform] duration-150 hover:-translate-y-px hover:border-ring",
        selected && "border-ring ring-1 ring-ring",
        data.dimmed && "opacity-30"
      )}
    >
      <Handle
        className="pointer-events-none opacity-0"
        position={Position.Left}
        type="target"
      />
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        <i
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone])}
        />
        <code className="truncate font-mono">{data.id}</code>
        {data.meta ? (
          <small className="ml-auto shrink-0">{data.meta}</small>
        ) : null}
      </span>
      <strong className="truncate font-medium text-sm">{data.title}</strong>
      <Handle
        className="pointer-events-none opacity-0"
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

const NODE_TYPES = { pier: GraphNode };

function initialFlowNodes(
  nodes: readonly NodeGraphNode[],
  /** 有 onSelectNode / editable 时节点进 Tab，便于键盘选中 */
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

function initialFlowEdges(edges: readonly NodeGraphEdge[]): Edge[] {
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

async function layoutNodes(
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

function NodeGraphInner({
  "aria-label": ariaLabel,
  className,
  direction = "left-to-right",
  edges,
  editable = false,
  emptyText = "No graph nodes to display.",
  highlightedIds,
  nodes,
  onConnectNodes,
  onNodePositionChange,
  onSelectNode,
  selectedId,
}: NodeGraphProps) {
  // 纯展示：不进 Tab。有选择/编辑合约时节点可键盘聚焦（产品 ring，非 UA 橙环）。
  const keyboardSelectable = editable || onSelectNode !== undefined;
  const [flowNodes, setFlowNodes] = useState(() =>
    initialFlowNodes(nodes, keyboardSelectable)
  );
  const flowEdges = useMemo(() => initialFlowEdges(edges), [edges]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    let active = true;
    let frame: number | undefined;
    const next = initialFlowNodes(nodes, keyboardSelectable);
    setFlowNodes(next);
    layoutNodes(nodes, edges, direction).then((positions) => {
      if (!active) {
        return;
      }
      setFlowNodes(
        next.map((node) => ({
          ...node,
          data: {
            ...node.data,
            dimmed: false,
          },
          position:
            node.data.position ?? positions.get(node.id) ?? node.position,
        }))
      );
      frame = requestAnimationFrame(() => {
        fitView(FIT_VIEW_OPTIONS).catch(() => undefined);
      });
    });
    return () => {
      active = false;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [direction, edges, fitView, keyboardSelectable, nodes]);

  useEffect(() => {
    setFlowNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          dimmed:
            highlightedIds !== undefined &&
            !highlightedIds.has(node.id) &&
            selectedId !== undefined,
        },
        draggable: editable,
        focusable: keyboardSelectable,
        selected: node.id === selectedId,
      }))
    );
  }, [editable, highlightedIds, keyboardSelectable, selectedId]);

  if (nodes.length === 0) {
    return (
      <div
        aria-label={ariaLabel}
        className={cn(
          "grid min-h-48 place-items-center rounded-lg border border-dashed bg-muted/30 text-muted-foreground text-sm",
          className
        )}
        data-slot="node-graph"
        role="img"
      >
        {emptyText}
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role 在 application|img 间切换，二者均支持 aria-label
    <div
      aria-label={ariaLabel}
      className={cn(
        "relative h-80 min-w-0 overflow-hidden rounded-lg border bg-muted/20",
        // xyflow 聚焦节点时用产品 ring，避免系统 UA outline
        "[&_.react-flow__node:focus-visible]:ring-2 [&_.react-flow__node:focus-visible]:ring-ring/40 [&_.react-flow__node:focus]:outline-none",
        className
      )}
      data-slot="node-graph"
      role={keyboardSelectable ? "application" : "img"}
    >
      <ReactFlow
        aria-label={ariaLabel}
        autoPanOnNodeFocus={keyboardSelectable}
        colorMode="system"
        edges={flowEdges}
        edgesFocusable={false}
        elementsSelectable
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.35}
        nodes={flowNodes}
        nodesConnectable={editable}
        nodesDraggable={editable}
        nodesFocusable={keyboardSelectable}
        nodeTypes={NODE_TYPES}
        onConnect={(connection) => {
          if (connection.source && connection.target) {
            onConnectNodes?.({
              source: connection.source,
              target: connection.target,
            });
          }
        }}
        onNodeClick={(_, node) => onSelectNode?.(node.id)}
        onNodeDragStop={(_, node) =>
          onNodePositionChange?.(node.id, node.position)
        }
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background
          color="var(--border)"
          gap={18}
          size={1}
          variant={BackgroundVariant.Lines}
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function NodeGraph(props: NodeGraphProps) {
  return (
    <ReactFlowProvider>
      <NodeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
