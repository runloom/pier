import { cn } from "../utils.ts";
import type { LaidOutFlowGraphEdge } from "./layout.ts";
import type { FlowGraphNodeStatus } from "./model.ts";

export function FlowGraphEdgeLayer({
  edges,
  markerId,
  sourceStatus,
}: {
  edges: readonly LaidOutFlowGraphEdge[];
  markerId: string;
  sourceStatus: ReadonlyMap<string, FlowGraphNodeStatus | undefined>;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 text-muted-foreground"
      height="100%"
      width="100%"
    >
      <defs>
        <marker
          id={markerId}
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="8"
          refY="4"
        >
          <path className="fill-current" d="M0,0 L8,4 L0,8 z" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const status = sourceStatus.get(edge.source);
        const running = status === "running";
        return (
          <g
            data-slot="flow-graph-edge"
            data-status={status ?? "idle"}
            key={`${edge.source}->${edge.target}${edge.label ? `:${edge.label}` : ""}`}
          >
            <path
              className={cn(
                "fill-none",
                running ? "stroke-status-info-fg" : "stroke-current"
              )}
              d={edge.d}
              markerEnd={`url(#${markerId})`}
              strokeDasharray={running ? "6 4" : undefined}
              strokeWidth={running ? 2 : 1.5}
            >
              {running ? (
                <animate
                  attributeName="stroke-dashoffset"
                  dur="0.8s"
                  from="0"
                  repeatCount="indefinite"
                  to="-20"
                />
              ) : null}
            </path>
            {edge.label ? (
              <text
                className="fill-muted-foreground stroke-background"
                fontSize={11}
                strokeWidth={3}
                style={{ paintOrder: "stroke" }}
                textAnchor="middle"
                x={edge.labelX}
                y={edge.labelY}
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
