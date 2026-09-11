import { workflowKindFill, workflowKindStroke } from "./kind.ts";
import type { WorkflowNodeKind, WorkflowNodeLayout } from "./types.ts";

export function lanePrefix(
  variant: "default" | "exception",
  index: number
): string {
  return variant === "exception" ? "EX" : String(index + 1).padStart(2, "0");
}

function KindSigil({
  kind,
  x,
  y,
}: {
  kind: WorkflowNodeKind;
  x: number;
  y: number;
}) {
  const stroke = workflowKindStroke(kind);
  const common = {
    fill: "none" as const,
    stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.35,
  };
  let mark = (
    <>
      <rect height="10" rx="2" width="12" x="2" y="3" {...common} />
      <path d="M2 6.4h12" {...common} />
    </>
  );
  if (kind === "gate") {
    mark = (
      <path
        d="M8 2.4 13.2 5v4.2c0 2.8-2.1 4.8-5.2 5.8C5 14 2.8 12 2.8 9.2V5Z"
        {...common}
      />
    );
  } else if (kind === "store") {
    mark = (
      <>
        <ellipse cx="8" cy="4.2" rx="5" ry="2" {...common} />
        <path d="M3 4.2v7.4c0 1.1 2.2 2 5 2s5-.9 5-2V4.2" {...common} />
      </>
    );
  } else if (kind === "system") {
    mark = (
      <>
        <path d="M3 5h10M3 8h10M3 11h10" {...common} />
        <circle cx="5.2" cy="5" fill={stroke} r="1" stroke="none" />
      </>
    );
  } else if (kind === "external") {
    mark = (
      <>
        <rect height="8" rx="1.4" width="8.2" x="2.6" y="5.2" {...common} />
        <path d="M8 2.6h5.2V8M13.2 2.6 7.6 8.4" {...common} />
      </>
    );
  }
  return (
    <g data-slot="workflow-sigil" transform={`translate(${x} ${y}) scale(0.7)`}>
      {mark}
    </g>
  );
}

export function NodeGlyph({
  node,
  state,
  onEnter,
}: {
  node: WorkflowNodeLayout;
  onEnter: () => void;
  state: "hot" | "idle";
}) {
  const fill = workflowKindFill(node.kind);
  const stroke = workflowKindStroke(node.kind);
  const cx = node.x + node.w / 2;
  const hasDetail = node.detail.length > 0;
  const labelY = hasDetail ? node.y + 21 : node.y + node.h / 2 + 4;
  return (
    <g
      data-kind={node.kind}
      data-node-id={node.id}
      data-slot="workflow-node"
      data-tag={node.tag || undefined}
      data-workflow-state={state}
      onPointerEnter={onEnter}
      style={{ cursor: "default" }}
    >
      <rect
        fill="var(--background)"
        height={node.h}
        rx={6}
        width={node.w}
        x={node.x}
        y={node.y}
      />
      <rect
        fill={fill}
        height={node.h}
        rx={6}
        stroke={stroke}
        strokeDasharray={node.kind === "external" ? "4 3" : undefined}
        strokeWidth={state === "hot" ? 2.4 : 1.5}
        width={node.w}
        x={node.x}
        y={node.y}
      />
      <KindSigil kind={node.kind} x={node.x + 6} y={node.y + 6} />
      <text
        fill="var(--foreground)"
        fontSize={11}
        fontWeight={600}
        textAnchor="middle"
        x={cx}
        y={labelY}
      >
        {node.label}
      </text>
      {hasDetail ? (
        <text
          fill="var(--muted-foreground)"
          fontSize={8}
          textAnchor="middle"
          x={cx}
          y={node.y + 38}
        >
          {node.detail}
        </text>
      ) : null}
      {node.tag ? (
        <g data-slot="workflow-node-tag">
          <rect
            fill="var(--background)"
            height={12}
            rx={3}
            width={Math.min(node.w - 24, node.tag.length * 5.2 + 10)}
            x={cx - Math.min(node.w - 24, node.tag.length * 5.2 + 10) / 2}
            y={node.y + node.h - 16}
          />
          <text
            fill={stroke}
            fontSize={9}
            textAnchor="middle"
            x={cx}
            y={node.y + node.h - 7}
          >
            {node.tag}
          </text>
        </g>
      ) : null}
    </g>
  );
}
