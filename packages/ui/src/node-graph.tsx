"use client";

import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MediaFullscreenButton } from "./image-preview/media-fullscreen-button.tsx";
import { FitViewOnViewportChange } from "./node-graph/expand.ts";
import {
  FIT_VIEW_OPTIONS,
  type GraphNodeData,
  INLINE_SURFACE_MIN_HEIGHT,
  initialFlowEdges,
  initialFlowNodes,
  inlineSurfaceHeightForLayout,
  layoutNodes,
  MIN_ZOOM,
  type NodeGraphDirection,
  type NodeGraphEdge,
  type NodeGraphNode,
  STAGE_FIT_VIEW_OPTIONS,
  STAGE_MAX_ZOOM,
  TONE_CLASS,
} from "./node-graph/model.ts";
import {
  type NodeGraphStageControlLabels,
  NodeGraphStageControls,
} from "./node-graph/stage-controls.tsx";
import { cn } from "./utils.ts";

export type {
  NodeGraphDirection,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphTone,
} from "./node-graph/model.ts";
export type { NodeGraphStageControlLabels } from "./node-graph/stage-controls.tsx";

export interface NodeGraphProps {
  "aria-label": string;
  className?: string | undefined;
  direction?: NodeGraphDirection | undefined;
  edges: readonly NodeGraphEdge[];
  editable?: boolean | undefined;
  emptyText?: string | undefined;
  /**
   * Top-right fullscreen control on the card. Default true.
   * Requires `onOpenFullscreen` (host content preview). Without a handler the
   * control is hidden — do not reintroduce a second immersive portal shell.
   */
  expandable?: boolean | undefined;
  /** aria-label for the fullscreen control. */
  expandLabel?: string | undefined;
  highlightedIds?: ReadonlySet<string> | undefined;
  nodes: readonly NodeGraphNode[];
  onConnectNodes?:
    | ((connection: { source: string; target: string }) => void)
    | undefined;
  onNodePositionChange?:
    | ((id: string, position: { x: number; y: number }) => void)
    | undefined;
  /**
   * Host opens content preview (same shell as markdown image / mermaid).
   * Required for the expand button to appear when `expandable` is true.
   */
  onOpenFullscreen?: (() => void) | undefined;
  onSelectNode?: ((id: string) => void) | undefined;
  /**
   * `card` — bordered inline overview (default).
   * `stage` — borderless fill for ContentPreviewHost body + bottom zoom bar.
   */
  presentation?: "card" | "stage" | undefined;
  selectedId?: string | undefined;
  /** i18n labels for stage bottom zoom strip (image-preview controls). */
  stageControlLabels?: NodeGraphStageControlLabels | undefined;
}

function GraphNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const tone = data.tone ?? "muted";
  return (
    <div
      className={cn(
        "box-border flex h-full w-full flex-col justify-center gap-1.5 rounded-md border bg-card px-3 py-3 text-left text-card-foreground shadow-sm transition-[border-color,box-shadow,opacity,transform] duration-150 hover:-translate-y-px hover:border-ring",
        selected && "border-ring ring-1 ring-ring",
        data.dimmed && "opacity-30"
      )}
    >
      <Handle
        className="pointer-events-none opacity-0"
        position={Position.Left}
        type="target"
      />
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs">
        <i
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone])}
        />
        <code className="break-all font-mono">{data.id}</code>
        {data.meta ? (
          <small className="ml-auto min-w-0 break-words">{data.meta}</small>
        ) : null}
      </span>
      <strong className="whitespace-normal break-words font-medium text-sm leading-5">
        {data.title}
      </strong>
      <Handle
        className="pointer-events-none opacity-0"
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

const NODE_TYPES = { pier: GraphNode };

function NodeGraphInner({
  "aria-label": ariaLabel,
  className,
  direction = "left-to-right",
  edges,
  editable = false,
  emptyText = "No graph nodes to display.",
  expandable = true,
  expandLabel = "View fullscreen",
  highlightedIds,
  nodes,
  onConnectNodes,
  onNodePositionChange,
  onOpenFullscreen,
  onSelectNode,
  presentation = "card",
  selectedId,
  stageControlLabels,
}: NodeGraphProps) {
  const isStage = presentation === "stage";
  const keyboardSelectable = editable || onSelectNode !== undefined;
  const [inlineHeight, setInlineHeight] = useState(INLINE_SURFACE_MIN_HEIGHT);
  const [flowNodes, setFlowNodes] = useState(() =>
    initialFlowNodes(nodes, keyboardSelectable)
  );
  const flowEdges = useMemo(() => initialFlowEdges(edges), [edges]);
  const { fitView } = useReactFlow();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fitOptions = isStage ? STAGE_FIT_VIEW_OPTIONS : FIT_VIEW_OPTIONS;
  const showExpand =
    !isStage &&
    expandable &&
    onOpenFullscreen !== undefined &&
    nodes.length > 0;

  useEffect(() => {
    let active = true;
    let frame: number | undefined;
    const next = initialFlowNodes(nodes, keyboardSelectable);
    setFlowNodes(next);
    if (nodes.length === 0) {
      setInlineHeight(INLINE_SURFACE_MIN_HEIGHT);
      return () => {
        active = false;
      };
    }
    layoutNodes(nodes, edges, direction).then((positions) => {
      if (!active) {
        return;
      }
      if (!isStage) {
        setInlineHeight(inlineSurfaceHeightForLayout(positions, nodes));
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
        fitView(fitOptions).catch(() => undefined);
      });
    });
    return () => {
      active = false;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [
    direction,
    edges,
    fitOptions,
    fitView,
    isStage,
    keyboardSelectable,
    nodes,
  ]);

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
          "grid min-h-48 place-items-center bg-background text-muted-foreground text-sm",
          !isStage && "rounded-lg border border-dashed bg-muted/30",
          className
        )}
        data-slot="node-graph"
        role="img"
      >
        {emptyText}
      </div>
    );
  }

  const surface = (
    <div
      className={cn(
        "group relative min-w-0 overflow-hidden bg-background",
        "[&_.react-flow]:bg-transparent! [&_.react-flow__pane]:bg-transparent! [&_.react-flow__renderer]:bg-transparent!",
        "[&_.react-flow__node:focus-visible]:ring-2 [&_.react-flow__node:focus-visible]:ring-ring/40 [&_.react-flow__node:focus]:outline-none",
        isStage
          ? "h-full min-h-0 w-full flex-1"
          : cn("rounded-lg border", className)
      )}
      data-presentation={presentation}
      data-slot={isStage ? "node-graph-stage" : "node-graph"}
      ref={surfaceRef}
      style={isStage ? undefined : { height: inlineHeight }}
    >
      <ReactFlow
        aria-label={ariaLabel}
        autoPanOnNodeFocus={keyboardSelectable}
        colorMode="system"
        edges={flowEdges}
        edgesFocusable={false}
        elementsSelectable
        fitView
        fitViewOptions={fitOptions}
        maxZoom={isStage ? STAGE_MAX_ZOOM : FIT_VIEW_OPTIONS.maxZoom}
        minZoom={MIN_ZOOM}
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
        // Card: pan allowed (overview when height-clamped); no wheel steal.
        // Stage: pan + wheel zoom (bottom strip too).
        panOnDrag
        preventScrolling={isStage}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        zoomOnPinch={isStage}
        zoomOnScroll={isStage}
      >
        <FitViewOnViewportChange
          containerRef={surfaceRef}
          fitViewOptions={fitOptions}
          token={isStage ? "stage" : `inline-${inlineHeight}`}
        />
        {isStage ? (
          <NodeGraphStageControls labels={stageControlLabels} />
        ) : null}
      </ReactFlow>
      {showExpand ? (
        <MediaFullscreenButton
          label={expandLabel}
          onClick={() => onOpenFullscreen?.()}
        />
      ) : null}
    </div>
  );

  if (keyboardSelectable) {
    return (
      <div
        aria-label={ariaLabel}
        className={cn(
          "min-w-0",
          isStage && "flex h-full min-h-0 flex-1 flex-col"
        )}
        data-slot="node-graph-root"
        role="application"
      >
        {surface}
      </div>
    );
  }
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "min-w-0",
        isStage && "flex h-full min-h-0 flex-1 flex-col"
      )}
      data-slot="node-graph-root"
      role="img"
    >
      {surface}
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
