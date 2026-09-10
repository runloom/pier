import type { ReactNode } from "react";
import { pointsAttr } from "./geometry.ts";
import type { WorkflowHighlight } from "./highlight.ts";
import { workflowLabelPaintBox } from "./label.ts";
import {
  SCREEN_FLOW_LABEL_GAP,
  SCREEN_FLOW_LABEL_PILL,
  SCREEN_FLOW_LABEL_SCALE,
  SCREEN_FLOW_LABEL_SIZE,
  WORKFLOW_FLOW_STROKE,
  WORKFLOW_HIT_STROKE,
  WORKFLOW_LABEL_GAP,
  WORKFLOW_LABEL_PILL,
  WORKFLOW_LABEL_SIZE,
  workflowLabelWidth,
} from "./metrics.ts";
import type { WorkflowHover, WorkflowLayout } from "./types.ts";
import { type EdgePaintKind, edgeVisual } from "./visual.ts";

interface EdgePaintProps {
  active: boolean;
  highlight: WorkflowHighlight;
  kind?: EdgePaintKind;
  layout: WorkflowLayout;
  onHover: (hover: WorkflowHover) => void;
}

function paintState(hot: boolean, active: boolean): "hot" | "idle" {
  return active && hot ? "hot" : "idle";
}

export function WorkflowEdgeStrokes({
  active,
  highlight,
  kind = "diagram",
  layout,
  onHover,
}: EdgePaintProps): ReactNode {
  return layout.edges.map((edge) => {
    const hot = !active || highlight.edges.has(edge.id);
    const visual = edgeVisual(edge, layout, kind);
    const shaft = visual.arrow?.stroke ?? edge.points;
    const flowing = active && hot;
    return (
      <g
        data-edge-id={edge.id}
        data-main-path={edge.onMainPath ? "true" : undefined}
        data-role={visual.paintRole}
        data-slot="workflow-edge"
        data-workflow-state={paintState(hot, active)}
        key={edge.id}
      >
        <polyline
          data-slot="workflow-edge-stroke"
          fill="none"
          points={pointsAttr(shaft)}
          stroke={visual.stroke}
          strokeLinecap="butt"
          strokeLinejoin="round"
          strokeWidth={visual.width}
        />
        {flowing ? (
          <polyline
            className="pier-workflow-edge-flow"
            data-slot="workflow-edge-flow"
            fill="none"
            pathLength={1}
            points={pointsAttr(shaft)}
            stroke={visual.stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={WORKFLOW_FLOW_STROKE}
            style={{ vectorEffect: "non-scaling-stroke" }}
          />
        ) : null}
        <polyline
          fill="none"
          onPointerEnter={() => {
            onHover({ id: edge.id, kind: "edge" });
          }}
          points={pointsAttr(shaft)}
          stroke="transparent"
          strokeWidth={WORKFLOW_HIT_STROKE}
          style={{
            cursor: "default",
            pointerEvents: "stroke",
            vectorEffect: "non-scaling-stroke",
          }}
        />
      </g>
    );
  });
}

export function WorkflowEdgeArrows({
  kind = "diagram",
  layout,
  onHover,
}: EdgePaintProps): ReactNode {
  return layout.edges.map((edge) => {
    const visual = edgeVisual(edge, layout, kind);
    if (!visual.arrow) {
      return null;
    }
    return (
      <polygon
        data-edge-id={edge.id}
        data-slot="workflow-edge-arrow"
        fill={visual.stroke}
        key={`${edge.id}-arrow`}
        onPointerEnter={() => {
          onHover({ id: edge.id, kind: "edge" });
        }}
        points={pointsAttr(visual.arrow.head)}
        style={{ cursor: "default", pointerEvents: "auto" }}
      />
    );
  });
}

export function WorkflowEdgeLabels({
  active,
  highlight,
  kind = "diagram",
  layout,
  onHover,
}: EdgePaintProps): ReactNode {
  const screens = kind === "screens";
  const pill = screens ? SCREEN_FLOW_LABEL_PILL : WORKFLOW_LABEL_PILL;
  return layout.edges.map((edge) => {
    if (edge.label.trim() === "") {
      return null;
    }
    const hot = !active || highlight.edges.has(edge.id);
    const labelW = screens
      ? Math.max(40, workflowLabelWidth(edge.label) * SCREEN_FLOW_LABEL_SCALE)
      : workflowLabelWidth(edge.label);
    const box = workflowLabelPaintBox(
      edge.points,
      edge.labelAt,
      labelW,
      pill,
      layout.nodes,
      screens ? SCREEN_FLOW_LABEL_GAP : WORKFLOW_LABEL_GAP
    );
    return (
      <g
        data-edge-id={edge.id}
        data-slot="workflow-edge-label"
        data-workflow-state={paintState(hot, active)}
        key={`${edge.id}-label`}
        onPointerEnter={() => {
          onHover({ id: edge.id, kind: "edge" });
        }}
        style={{ cursor: "default", pointerEvents: "auto" }}
      >
        <rect
          fill="var(--background)"
          height={pill}
          rx={screens ? 6 : 3}
          stroke={screens ? "var(--border)" : undefined}
          strokeWidth={screens ? 1 : undefined}
          width={labelW}
          x={box.x}
          y={box.y}
        />
        <text
          fill="var(--foreground)"
          fontSize={screens ? SCREEN_FLOW_LABEL_SIZE : WORKFLOW_LABEL_SIZE}
          fontWeight={edge.onMainPath ? 600 : 400}
          textAnchor="middle"
          x={box.x + labelW / 2}
          y={box.y + pill / 2 + (screens ? 4 : 1)}
        >
          {edge.label}
        </text>
      </g>
    );
  });
}

export function WorkflowEdgeMarks(props: EdgePaintProps): ReactNode {
  return (
    <>
      <WorkflowEdgeArrows {...props} />
      <WorkflowEdgeLabels {...props} />
    </>
  );
}

export function WorkflowEdges(props: EdgePaintProps): ReactNode {
  return (
    <>
      <WorkflowEdgeStrokes {...props} />
      <WorkflowEdgeMarks {...props} />
    </>
  );
}

export function WorkflowOverlaySvg({
  children,
  height,
  slot,
  width,
  zIndex,
}: {
  children: ReactNode;
  height: number;
  slot: string;
  width: number;
  zIndex: number;
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      data-slot={slot}
      height={height}
      style={{
        display: "block",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        position: "absolute",
        zIndex,
      }}
      width={width}
    >
      {children}
    </svg>
  );
}
