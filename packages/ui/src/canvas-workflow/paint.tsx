import { useId, useState } from "react";
import { cn } from "../utils.ts";
import { WorkflowEdgeMarks, WorkflowEdgeStrokes } from "./edges.tsx";
import { lanePrefix, NodeGlyph } from "./glyph.tsx";
import {
  workflowHighlight,
  workflowHighlightActive,
  workflowHoverFromTarget,
} from "./highlight.ts";
import {
  workflowKindFill,
  workflowKindStroke,
  workflowNodeKind,
} from "./kind.ts";
import type { WorkflowHover, WorkflowLayout, WorkflowSpec } from "./types.ts";

export function WorkflowPaint({
  className,
  layout,
  legendLabel = "Legend",
  spec,
}: {
  className?: string | undefined;
  layout: WorkflowLayout;
  legendLabel?: string;
  spec: WorkflowSpec;
}) {
  const uid = useId().replaceAll(":", "");
  const [hover, setHover] = useState<WorkflowHover>(null);
  const highlight = workflowHighlight(spec, hover);
  const active = workflowHighlightActive(highlight);
  const originX = layout.lanes[0]?.x ?? 40;

  return (
    <div
      aria-label={layout.title}
      className={cn("relative", className)}
      data-slot="workflow-diagram"
      onPointerLeave={() => {
        setHover(null);
      }}
      onPointerOver={(event) => {
        setHover(workflowHoverFromTarget(event.target));
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
              strokeDasharray={lane.variant === "exception" ? "6 6" : undefined}
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
                strokeOpacity={0.55}
                strokeWidth={1}
                width={group.w}
                x={group.x}
                y={group.y}
              />
              <rect
                fill="var(--background)"
                height={12}
                width={Math.min(group.w - 16, group.label.length * 6.2 + 12)}
                x={group.x + 8}
                y={group.y - 6}
              />
              <text
                fill={groupStroke}
                fontSize={10}
                fontWeight={600}
                x={group.x + 10}
                y={group.y + 4}
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
        <WorkflowEdgeStrokes
          active={active}
          highlight={highlight}
          layout={layout}
          onHover={setHover}
        />
        {layout.nodes.map((node) => {
          const related = highlight.nodes.has(node.id);
          const state =
            active && related ? ("hot" as const) : ("idle" as const);
          return (
            <NodeGlyph
              key={node.id}
              node={node}
              onEnter={() => {
                setHover({ id: node.id, kind: "node" });
              }}
              state={state}
            />
          );
        })}
        <WorkflowEdgeMarks
          active={active}
          highlight={highlight}
          layout={layout}
          onHover={setHover}
        />
        {layout.legend.length > 0 ? (
          <g data-slot="workflow-legend">
            <text
              fill="var(--foreground)"
              fontSize={11}
              fontWeight={600}
              x={originX}
              y={layout.legendY + 12}
            >
              {legendLabel}
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
