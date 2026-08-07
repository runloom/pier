"use client";

import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button.tsx";
import {
  FitViewOnViewportChange,
  useNodeGraphExpandedChrome,
} from "./node-graph-expand.ts";
import {
  FIT_VIEW_OPTIONS,
  type GraphNodeData,
  initialFlowEdges,
  initialFlowNodes,
  layoutNodes,
  MIN_ZOOM,
  type NodeGraphDirection,
  type NodeGraphEdge,
  type NodeGraphNode,
  TONE_CLASS,
} from "./node-graph-model.ts";
import { cn } from "./utils.ts";

export type {
  NodeGraphDirection,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphTone,
} from "./node-graph-model.ts";

export interface NodeGraphProps {
  "aria-label": string;
  className?: string | undefined;
  /** aria-label / title for collapse control and header close. */
  collapseLabel?: string | undefined;
  direction?: NodeGraphDirection | undefined;
  edges: readonly NodeGraphEdge[];
  editable?: boolean | undefined;
  emptyText?: string | undefined;
  /**
   * Immersive expand control (not browser fullscreen). Default true.
   * Portal overlay fills the window under the app title bar.
   */
  expandable?: boolean | undefined;
  /** aria-label / title for expand control. */
  expandLabel?: string | undefined;
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

function NodeGraphInner({
  "aria-label": ariaLabel,
  className,
  collapseLabel = "Exit expanded graph",
  direction = "left-to-right",
  edges,
  editable = false,
  emptyText = "No graph nodes to display.",
  expandable = true,
  expandLabel = "Expand graph",
  highlightedIds,
  nodes,
  onConnectNodes,
  onNodePositionChange,
  onSelectNode,
  selectedId,
}: NodeGraphProps) {
  const keyboardSelectable = editable || onSelectNode !== undefined;
  const [expanded, setExpanded] = useState(false);
  const [flowNodes, setFlowNodes] = useState(() =>
    initialFlowNodes(nodes, keyboardSelectable)
  );
  const flowEdges = useMemo(() => initialFlowEdges(edges), [edges]);
  const { fitView } = useReactFlow();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const showExpanded = expanded && nodes.length > 0;

  useEffect(() => {
    if (nodes.length === 0 && expanded) {
      setExpanded(false);
    }
  }, [expanded, nodes.length]);

  useNodeGraphExpandedChrome({
    dialogRef,
    restoreFocusRef,
    setExpanded,
    showExpanded,
  });

  useEffect(() => {
    let active = true;
    let frame: number | undefined;
    const next = initialFlowNodes(nodes, keyboardSelectable);
    setFlowNodes(next);
    if (nodes.length === 0) {
      return () => {
        active = false;
      };
    }
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

  const expandControlLabel = showExpanded ? collapseLabel : expandLabel;
  const surface = (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden bg-muted/20",
        "[&_.react-flow__node:focus-visible]:ring-2 [&_.react-flow__node:focus-visible]:ring-ring/40 [&_.react-flow__node:focus]:outline-none",
        showExpanded
          ? "h-full min-h-0 flex-1 rounded-lg border"
          : cn("h-80 rounded-lg border", className)
      )}
      data-expanded={showExpanded ? "true" : "false"}
      data-slot={showExpanded ? "node-graph-expanded-surface" : "node-graph"}
      ref={surfaceRef}
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
        <Controls
          fitViewOptions={FIT_VIEW_OPTIONS}
          position="bottom-right"
          showInteractive={false}
        >
          {expandable ? (
            <ControlButton
              aria-label={expandControlLabel}
              className="react-flow__controls-expand"
              onClick={() => {
                if (!showExpanded) {
                  restoreFocusRef.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                }
                setExpanded((value) => !value);
              }}
              title={expandControlLabel}
              type="button"
            >
              {showExpanded ? (
                <Minimize2Icon aria-hidden="true" />
              ) : (
                <Maximize2Icon aria-hidden="true" />
              )}
            </ControlButton>
          ) : null}
        </Controls>
        <FitViewOnViewportChange
          containerRef={surfaceRef}
          token={showExpanded ? "expanded" : "inline"}
        />
      </ReactFlow>
    </div>
  );

  if (!showExpanded) {
    if (keyboardSelectable) {
      return (
        <div
          aria-label={ariaLabel}
          className="min-w-0"
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
        className="min-w-0"
        data-slot="node-graph-root"
        role="img"
      >
        {surface}
      </div>
    );
  }

  const overlay =
    typeof document === "undefined"
      ? null
      : createPortal(
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="app-no-drag fixed top-[var(--app-titlebar-height,0px)] right-0 bottom-0 left-0 z-50 flex flex-col gap-3 bg-background/95 p-4 backdrop-blur-sm"
            data-slot="node-graph-expanded"
            ref={dialogRef}
            role="dialog"
          >
            <div className="flex shrink-0 items-center justify-between gap-3">
              <span className="truncate font-medium text-sm" id={titleId}>
                {ariaLabel}
              </span>
              <Button
                aria-label={collapseLabel}
                autoFocus
                data-node-graph-close=""
                onClick={() => setExpanded(false)}
                size="icon"
                type="button"
                variant="outline"
              >
                <XIcon data-icon="inline-start" />
              </Button>
            </div>
            {surface}
          </div>,
          document.body
        );

  return (
    <>
      <div
        aria-hidden="true"
        className={cn("h-80 min-w-0 rounded-lg border bg-muted/20", className)}
        data-slot="node-graph-placeholder"
      />
      {overlay}
    </>
  );
}

export function NodeGraph(props: NodeGraphProps) {
  return (
    <ReactFlowProvider>
      <NodeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
