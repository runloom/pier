"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { canvasWorldScale } from "../image-preview/canvas-math.ts";
import type { ImagePreviewCanvasLabels } from "../image-preview/controls.tsx";
import { HtmlWorldCanvas } from "../image-preview/world-canvas.tsx";
import { cn } from "../utils.ts";
import { FlowGraphEdgeLayer } from "./edges.tsx";
import { layoutFlowGraph } from "./layout.ts";
import {
  type FlowGraphDirection,
  type FlowGraphEdge,
  type FlowGraphNode,
  type FlowGraphOverlayLayout,
  type FlowGraphPositions,
  type FlowGraphRenderNodeContent,
  type FlowGraphRenderOverlay,
  flowGraphNodeSize,
} from "./model.ts";
import { FlowGraphNodeCard } from "./node.tsx";
import { FlowGraphEmpty, FlowGraphShell } from "./shell.tsx";

const DEFAULT_STAGE_LABELS: ImagePreviewCanvasLabels = {
  actualSize: "Actual size",
  controlsLabel: "Zoom controls",
  fit: "Fit to window",
  loadFailedDescription: "",
  loadFailedTitle: "",
  loading: "",
  viewerLabel: "Graph",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom level",
  zoomOut: "Zoom out",
};

export interface FlowGraphProps {
  "aria-label": string;
  className?: string | undefined;
  direction?: FlowGraphDirection | undefined;
  edges?: readonly FlowGraphEdge[] | undefined;
  emptyText?: string | undefined;
  expandable?: boolean | undefined;
  expandLabel?: string | undefined;
  nodes?: readonly FlowGraphNode[] | undefined;
  onNodePositionsChange?: ((positions: FlowGraphPositions) => void) | undefined;
  onOpenFullscreen?: (() => void) | undefined;
  onSelectNode?: ((id: string) => void) | undefined;
  /** Controlled node positions. Omit to use the layered layout. */
  positions?: FlowGraphPositions | undefined;
  /**
   * `card` (default) bordered inline overview; `stage` fill for content
   * preview; `plain` for world-stage placement (no nested zoom card).
   */
  presentation?: "card" | "plain" | "stage" | undefined;
  /**
   * Display chrome under the title. Interactive controls belong beside the
   * graph (`onSelectNode`), not inside the node.
   */
  renderNodeContent?: FlowGraphRenderNodeContent | undefined;
  /** Marks anchored to laid-out node positions (gates, captions). */
  renderOverlay?: FlowGraphRenderOverlay | undefined;
  selectedId?: string | undefined;
  stageControlLabels?:
    | Pick<
        ImagePreviewCanvasLabels,
        | "actualSize"
        | "controlsLabel"
        | "fit"
        | "zoomIn"
        | "zoomLevel"
        | "zoomOut"
      >
    | undefined;
}

export function FlowGraph(props: FlowGraphProps) {
  const {
    "aria-label": ariaLabel,
    className,
    direction = "left-to-right",
    edges = [],
    emptyText = "No graph to display.",
    expandable = true,
    expandLabel = "View fullscreen",
    nodes = [],
    onNodePositionsChange,
    onOpenFullscreen,
    onSelectNode,
    presentation = "card",
    positions: positionsProp,
    renderNodeContent,
    renderOverlay,
    selectedId,
    stageControlLabels,
  } = props;
  const isStage = presentation === "stage";
  const isPlain = presentation === "plain";
  const keyboardSelectable = onSelectNode !== undefined;
  const draggable = onNodePositionsChange !== undefined;
  const markerId = `fg-arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [draft, setDraft] = useState<FlowGraphPositions | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    []
  );

  const laid = useMemo(() => {
    const overlay = { ...positionsProp, ...draft };
    return layoutFlowGraph({
      direction,
      edges,
      nodes: nodes.map((node) => ({
        id: node.id,
        ...flowGraphNodeSize(node),
      })),
      ...(Object.keys(overlay).length > 0 ? { positions: overlay } : {}),
    });
  }, [direction, draft, edges, nodes, positionsProp]);

  const sourceStatus = useMemo(() => {
    const map = new Map<string, FlowGraphNode["status"]>();
    for (const node of nodes) {
      map.set(node.id, node.status);
    }
    return map;
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <FlowGraphEmpty
        aria-label={ariaLabel}
        className={className}
        isStage={isStage || isPlain}
        text={emptyText}
      />
    );
  }

  const startDrag = (nodeId: string, event: ReactPointerEvent): void => {
    if (!draggable || event.button !== 0) {
      return;
    }
    const origin = laid.positions[nodeId];
    if (!origin) {
      return;
    }
    const targetEl =
      event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    // Pointer deltas are visual px; positions are world px. Divide by the
    // stage scale (CSS zoom on the world shell) or dragging lags the pointer.
    const scale = targetEl ? canvasWorldScale(targetEl) : 1;
    let moved = false;

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (
        targetEl &&
        typeof targetEl.hasPointerCapture === "function" &&
        targetEl.hasPointerCapture(pointerId)
      ) {
        try {
          targetEl.releasePointerCapture(pointerId);
        } catch {
          // Ignore capture release error
        }
      }
      dragCleanupRef.current = null;
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const dx = (moveEvent.clientX - startX) / scale;
      const dy = (moveEvent.clientY - startY) / scale;
      if (!moved && dx * dx + dy * dy < 16) {
        return;
      }
      if (!moved) {
        moved = true;
        if (targetEl && typeof targetEl.setPointerCapture === "function") {
          try {
            targetEl.setPointerCapture(pointerId);
          } catch {
            // Ignore capture error
          }
        }
      }
      setDraft({
        ...laid.positions,
        [nodeId]: { x: origin.x + dx, y: origin.y + dy },
      });
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      setDraft(null);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      if (!moved) {
        setDraft(null);
        return;
      }
      const next = {
        ...laid.positions,
        [nodeId]: {
          x: origin.x + (upEvent.clientX - startX) / scale,
          y: origin.y + (upEvent.clientY - startY) / scale,
        },
      };
      setDraft(null);
      onNodePositionsChange?.(next);
    };

    dragCleanupRef.current = () => {
      cleanup();
      setDraft(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const overlayLayout: FlowGraphOverlayLayout = {
    height: laid.height,
    positions: laid.positions,
    width: laid.width,
  };

  const plane = (
    <div
      className="relative"
      data-slot="flow-graph-plane"
      style={{ height: laid.height, width: laid.width }}
    >
      <FlowGraphEdgeLayer
        edges={laid.edges}
        markerId={markerId}
        sourceStatus={sourceStatus}
      />
      {nodes.map((node) => {
        const position = laid.positions[node.id];
        if (!position) {
          return null;
        }
        const size = flowGraphNodeSize(node);
        return (
          <div
            className={cn("select-none", draggable && "cursor-grab")}
            data-no-drag={draggable ? "" : undefined}
            key={node.id}
            {...(draggable
              ? {
                  onPointerDown: (event: ReactPointerEvent) => {
                    startDrag(node.id, event);
                  },
                }
              : {})}
            style={{
              height: size.height,
              left: position.x,
              position: "absolute",
              top: position.y,
              width: size.width,
            }}
          >
            <FlowGraphNodeCard
              content={renderNodeContent?.(node) ?? null}
              keyboardSelectable={keyboardSelectable}
              node={node}
              onSelect={onSelectNode}
              selected={selectedId === node.id}
            />
          </div>
        );
      })}
      {renderOverlay ? (
        <div
          className="pointer-events-none absolute inset-0"
          data-slot="flow-graph-overlay"
        >
          {renderOverlay(overlayLayout)}
        </div>
      ) : null}
    </div>
  );

  if (isStage) {
    const labels: ImagePreviewCanvasLabels = {
      ...DEFAULT_STAGE_LABELS,
      ...stageControlLabels,
      viewerLabel: ariaLabel,
    };
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col">
        <HtmlWorldCanvas
          className="min-h-0 w-full flex-1 bg-background"
          expandable={false}
          labels={labels}
          presentation="stage"
          viewerLabel={ariaLabel}
        >
          <div data-slot="flow-graph-stage">{plane}</div>
        </HtmlWorldCanvas>
      </div>
    );
  }

  if (isPlain && keyboardSelectable) {
    return (
      <div
        aria-label={ariaLabel}
        className={className}
        data-slot="flow-graph"
        role="application"
      >
        {plane}
      </div>
    );
  }

  if (isPlain) {
    return (
      <div
        aria-label={ariaLabel}
        className={className}
        data-slot="flow-graph"
        role="img"
      >
        {plane}
      </div>
    );
  }

  return (
    <FlowGraphShell
      aria-label={ariaLabel}
      className={className}
      expandLabel={expandLabel}
      keyboardSelectable={keyboardSelectable}
      onOpenFullscreen={onOpenFullscreen}
      showExpand={Boolean(expandable && onOpenFullscreen)}
    >
      <div className="p-3">{plane}</div>
    </FlowGraphShell>
  );
}
