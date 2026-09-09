import { useId, useState } from "react";
import { cn } from "../utils.ts";
import { pointsAttr } from "./geometry.ts";
import { lanePrefix, NodeGlyph, workflowState } from "./glyph.tsx";
import { workflowHighlight, workflowHighlightActive } from "./highlight.ts";
import {
  workflowKindFill,
  workflowKindStroke,
  workflowNodeKind,
} from "./kind.ts";
import {
  WORKFLOW_DIM_OPACITY,
  WORKFLOW_HIT_STROKE,
  WORKFLOW_LABEL_PILL,
  workflowLabelWidth,
} from "./metrics.ts";
import { workflowEdgeDash } from "./role.ts";
import type { WorkflowHover, WorkflowLayout, WorkflowSpec } from "./types.ts";
import { edgeVisual } from "./visual.ts";

export function WorkflowPaint({
  className,
  layout,
  spec,
}: {
  className?: string;
  layout: WorkflowLayout;
  spec: WorkflowSpec;
}) {
  const uid = useId().replaceAll(":", "");
  const [hover, setHover] = useState<WorkflowHover>(null);
  const highlight = workflowHighlight(spec, hover);
  const active = workflowHighlightActive(highlight);
  const originX = layout.lanes[0]?.x ?? 40;

  return (
    <div
      className={cn("relative", className)}
      data-slot="workflow-diagram"
      onPointerLeave={() => {
        setHover(null);
      }}
      role="img"
      style={{ height: layout.height, width: layout.width }}
    >
      <svg
        aria-hidden="true"
        height={layout.height}
        style={{ display: "block", overflow: "visible" }}
        width={layout.width}
      >
        <defs>
          <pattern
            height={40}
            id={`${uid}-grid`}
            patternUnits="userSpaceOnUse"
            width={40}
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="var(--border)"
              strokeOpacity={0.45}
              strokeWidth={0.5}
            />
          </pattern>
        </defs>
        <rect fill={`url(#${uid}-grid)`} height="100%" width="100%" />
        {layout.title ? (
          <text
            data-slot="workflow-title"
            fill="var(--foreground)"
            fontSize={16}
            fontWeight={600}
            x={originX}
            y={22}
          >
            {layout.title}
          </text>
        ) : null}
        {layout.lanes.map((lane, index) => (
          <g
            data-lane-id={lane.id}
            data-slot="workflow-lane"
            data-variant={lane.variant}
            key={lane.id}
          >
            <rect
              data-variant={lane.variant}
              fill={
                lane.variant === "exception"
                  ? "transparent"
                  : "color-mix(in srgb, var(--status-info-fg) 4%, var(--background))"
              }
              height={lane.h}
              rx={10}
              stroke={
                lane.variant === "exception"
                  ? "var(--status-danger-fg)"
                  : "var(--border)"
              }
              strokeDasharray="6 6"
              strokeWidth={1}
              width={lane.w}
              x={lane.x}
              y={lane.y}
            />
            <text
              fill={
                lane.variant === "exception"
                  ? "var(--status-danger-fg)"
                  : "var(--muted-foreground)"
              }
              fontSize={10}
              fontWeight={600}
              x={lane.x + 14}
              y={lane.y + 22}
            >
              {`${lanePrefix(lane.variant, index)} / ${lane.label}`}
            </text>
          </g>
        ))}
        {layout.groups.map((group) => {
          const owner = layout.lanes.find(
            (lane) => group.y >= lane.y && group.y <= lane.y + lane.h
          );
          const groupStroke =
            owner?.variant === "exception"
              ? "var(--status-danger-fg)"
              : "var(--muted-foreground)";
          return (
            <g
              data-group-id={group.id}
              data-slot="workflow-group"
              key={group.id}
            >
              <rect
                fill={
                  owner?.variant === "exception"
                    ? "color-mix(in srgb, var(--status-danger-fg) 7%, transparent)"
                    : "color-mix(in srgb, var(--foreground) 3%, transparent)"
                }
                height={group.h}
                rx={9}
                stroke={groupStroke}
                strokeDasharray="5 4"
                strokeOpacity={0.9}
                strokeWidth={1.15}
                width={group.w}
                x={group.x}
                y={group.y}
              />
              <rect
                fill="var(--background)"
                height={10}
                width={Math.min(group.w - 16, group.label.length * 5.6 + 10)}
                x={group.x + 8}
                y={group.y - 5}
              />
              <text
                fill={groupStroke}
                fontSize={7}
                fontWeight={600}
                x={group.x + 10}
                y={group.y + 3}
              >
                {group.label}
              </text>
            </g>
          );
        })}
        {layout.phases.map((phase, phaseIndex) => {
          const pillW = Math.min(phase.w, phase.label.length * 7 + 18);
          const pillX = phase.x + (phase.w - pillW) / 2;
          const phaseInk =
            [
              "var(--muted-foreground)",
              "var(--status-success-fg)",
              "var(--status-warning-fg)",
            ][phaseIndex] ?? "var(--muted-foreground)";
          return (
            <g
              data-phase-id={phase.id}
              data-slot="workflow-phase"
              key={phase.id}
            >
              <line
                stroke={phaseInk}
                strokeOpacity={0.55}
                strokeWidth={1.1}
                x1={phase.x}
                x2={phase.x + phase.w}
                y1={phase.y}
                y2={phase.y}
              />
              <rect
                fill="var(--background)"
                height={14}
                rx={4}
                width={pillW}
                x={pillX}
                y={phase.y - 7}
              />
              <text
                fill={phaseInk}
                fontSize={9}
                fontWeight={600}
                textAnchor="middle"
                x={phase.x + phase.w / 2}
                y={phase.y + 3}
              >
                {phase.label}
              </text>
            </g>
          );
        })}
        {layout.edges.map((edge) => {
          const hot = !active || highlight.edges.has(edge.id);
          const visual = edgeVisual(edge, layout);
          const shaft = visual.arrow?.stroke ?? edge.points;
          const flowing = active && hot;
          const dash =
            flowing || visual.localMain
              ? undefined
              : workflowEdgeDash(visual.markRole, visual.onSpine);
          const state = workflowState(hot, active);
          return (
            <g
              data-edge-id={edge.id}
              data-main-path={edge.onMainPath ? "true" : undefined}
              data-role={visual.paintRole}
              data-slot="workflow-edge"
              data-workflow-state={state}
              key={edge.id}
              opacity={hot ? 1 : WORKFLOW_DIM_OPACITY}
            >
              <polyline
                data-slot="workflow-edge-stroke"
                fill="none"
                points={pointsAttr(shaft)}
                stroke={visual.stroke}
                strokeDasharray={dash}
                strokeLinecap="butt"
                strokeLinejoin="round"
                strokeWidth={visual.width}
              />
              {flowing ? (
                <polyline
                  className="pier-workflow-edge-flow"
                  data-slot="workflow-edge-flow"
                  fill="none"
                  points={pointsAttr(shaft)}
                  stroke={visual.stroke}
                  strokeLinecap="butt"
                  strokeLinejoin="round"
                  strokeWidth={visual.width}
                />
              ) : null}
              <polyline
                fill="none"
                onPointerEnter={() => {
                  setHover({ id: edge.id, kind: "edge" });
                }}
                points={pointsAttr(edge.points)}
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
        })}
        {layout.nodes.map((node) => {
          const hot = !active || highlight.nodes.has(node.id);
          return (
            <NodeGlyph
              hot={hot}
              key={node.id}
              node={node}
              onEnter={() => {
                setHover({ id: node.id, kind: "node" });
              }}
              state={workflowState(hot, active)}
            />
          );
        })}
        {layout.edges.map((edge) => {
          const visual = edgeVisual(edge, layout);
          if (!visual.arrow) {
            return null;
          }
          const hot = !active || highlight.edges.has(edge.id);
          return (
            <polygon
              data-edge-id={edge.id}
              data-slot="workflow-edge-arrow"
              fill={visual.stroke}
              key={`${edge.id}-arrow`}
              onPointerEnter={() => {
                setHover({ id: edge.id, kind: "edge" });
              }}
              opacity={hot ? 1 : WORKFLOW_DIM_OPACITY}
              points={pointsAttr(visual.arrow.head)}
              style={{ cursor: "default" }}
            />
          );
        })}
        {layout.edges.map((edge) => {
          if (edge.label.trim() === "") {
            return null;
          }
          const hot = !active || highlight.edges.has(edge.id);
          const labelW = workflowLabelWidth(edge.label);
          const x = edge.labelAt.x - labelW / 2;
          const y = edge.labelAt.y - WORKFLOW_LABEL_PILL / 2;
          return (
            <g
              data-edge-id={edge.id}
              data-slot="workflow-edge-label"
              data-workflow-state={workflowState(hot, active)}
              key={`${edge.id}-label`}
              onPointerEnter={() => {
                setHover({ id: edge.id, kind: "edge" });
              }}
              opacity={hot ? 1 : WORKFLOW_DIM_OPACITY}
              style={{ cursor: "default" }}
            >
              <rect
                fill="var(--background)"
                height={WORKFLOW_LABEL_PILL}
                rx={3}
                width={labelW}
                x={x}
                y={y}
              />
              <text
                fill="var(--foreground)"
                fontSize={7}
                fontWeight={edge.onMainPath ? 600 : 400}
                textAnchor="middle"
                x={edge.labelAt.x}
                y={edge.labelAt.y + 1}
              >
                {edge.label}
              </text>
            </g>
          );
        })}
        {layout.legend.length > 0 ? (
          <g data-slot="workflow-legend">
            <text
              fill="var(--foreground)"
              fontSize={11}
              fontWeight={600}
              x={originX}
              y={layout.legendY + 12}
            >
              Legend
            </text>
            {layout.legend.map((item, index) => {
              const x = originX + 64 + index * 108;
              const y = layout.legendY + 4;
              return (
                <g
                  data-kind={item.kind}
                  data-slot="workflow-legend-item"
                  key={item.kind}
                >
                  <rect
                    fill={workflowKindFill(workflowNodeKind(item.kind))}
                    height={9}
                    rx={2}
                    stroke={workflowKindStroke(item.kind)}
                    strokeWidth={1}
                    width={14}
                    x={x}
                    y={y}
                  />
                  <text
                    fill="var(--muted-foreground)"
                    fontSize={10}
                    x={x + 18}
                    y={y + 9}
                  >
                    {item.label}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}
        {layout.notes.length > 0 ? (
          <g data-slot="workflow-notes">
            {layout.notes.map((note, index) => {
              const cardW = 360;
              const cardH = 72;
              const x = originX + index * (cardW + 16);
              const y = layout.notesY;
              const dot =
                index === 0
                  ? "var(--status-info-fg)"
                  : "var(--status-danger-fg)";
              return (
                <g data-slot="workflow-note" key={note.title}>
                  <rect
                    fill="var(--card)"
                    height={cardH}
                    rx={12}
                    stroke="var(--border)"
                    width={cardW}
                    x={x}
                    y={y}
                  />
                  <circle cx={x + 16} cy={y + 16} fill={dot} r={4} />
                  <text
                    fill="var(--foreground)"
                    fontSize={13}
                    fontWeight={600}
                    x={x + 26}
                    y={y + 20}
                  >
                    {note.title}
                  </text>
                  {note.items.map((item, itemIndex) => (
                    <text
                      fill="var(--muted-foreground)"
                      fontSize={11}
                      key={item}
                      x={x + 16}
                      y={y + 40 + itemIndex * 16}
                    >
                      {item}
                    </text>
                  ))}
                </g>
              );
            })}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
