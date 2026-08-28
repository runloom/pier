import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../badge.tsx";
import { cn } from "../utils.ts";
import {
  FLOW_GRAPH_STATUS_SURFACE,
  type FlowGraphNode,
  type FlowGraphNodeStatus,
} from "./model.ts";

const TERMINAL_GLYPH: Record<
  Exclude<FlowGraphNodeStatus, "blocked" | "queued" | "ready" | "running">,
  { className: string; Icon: LucideIcon }
> = {
  failed: { className: "text-status-danger-fg", Icon: CircleX },
  skipped: { className: "text-muted-foreground", Icon: CircleMinus },
  success: { className: "text-status-success-fg", Icon: CircleCheck },
};

function StatusGlyph({ node }: { node: FlowGraphNode }) {
  const status = node.status;
  if (!status) {
    return null;
  }
  const label = node.statusLabel ?? status;
  if (status === "running") {
    return (
      <span
        aria-label={label}
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-status-info-fg border-t-transparent"
        data-run-status="running"
        role="status"
      />
    );
  }
  if (status === "queued") {
    return (
      <span
        aria-label={label}
        className="size-3 shrink-0 rounded-full border-2 border-status-info-fg border-dashed"
        data-run-status="queued"
        role="img"
      />
    );
  }
  if (status === "ready") {
    return (
      <span
        aria-label={label}
        className="size-3 shrink-0 rounded-full bg-status-success-fg"
        data-run-status="ready"
        role="img"
      />
    );
  }
  if (status === "blocked") {
    return (
      <CircleAlert
        aria-label={label}
        className="size-3 shrink-0 text-status-warning-fg"
        data-icon
        data-run-status="blocked"
        role="img"
      />
    );
  }
  const { className, Icon } = TERMINAL_GLYPH[status];
  return (
    <Icon
      aria-label={label}
      className={cn("size-3 shrink-0", className)}
      data-icon
      data-run-status={status}
      role="img"
    />
  );
}

export function FlowGraphNodeCard({
  content,
  keyboardSelectable,
  node,
  onSelect,
  selected,
}: {
  /** Display chrome only. Interactive controls belong beside the graph. */
  content: ReactNode;
  keyboardSelectable: boolean;
  node: FlowGraphNode;
  onSelect?: ((id: string) => void) | undefined;
  selected: boolean;
}) {
  const surface = node.status
    ? FLOW_GRAPH_STATUS_SURFACE[node.status]
    : "border-border bg-card";
  const card = (
    <div
      className={cn(
        "relative flex h-full w-full flex-col justify-center rounded-md border px-3 py-2 text-left text-card-foreground text-sm",
        surface,
        selected && "ring-1 ring-ring/40"
      )}
      data-slot="flow-graph-node"
      data-status={node.status ?? "idle"}
    >
      {node.badge ? (
        <Badge
          className="absolute -top-2 right-1.5 max-w-[7rem] truncate"
          variant="outline"
        >
          {node.badge}
        </Badge>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {node.label}
        </span>
        <StatusGlyph node={node} />
      </div>
      {node.meta ? (
        <span className="mt-0.5 min-w-0 truncate text-muted-foreground text-xs">
          {node.meta}
        </span>
      ) : null}
      {content != null && content !== false ? (
        <div
          className="mt-2 min-w-0 overflow-hidden"
          data-slot="flow-graph-node-content"
          style={
            node.contentHeight && node.contentHeight > 0
              ? { height: node.contentHeight }
              : undefined
          }
        >
          {content}
        </div>
      ) : null}
    </div>
  );
  if (keyboardSelectable) {
    return (
      <button
        aria-label={node.label}
        className="h-full w-full bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onSelect?.(node.id)}
        type="button"
      >
        {card}
      </button>
    );
  }
  return (
    <div aria-label={node.label} className="h-full w-full" role="img">
      {card}
    </div>
  );
}
