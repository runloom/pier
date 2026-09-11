import {
  WORKFLOW_NODE_DETAIL,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_TAGGED,
} from "./metrics.ts";
import {
  WORKFLOW_NODE_KINDS,
  type WorkflowLegendItem,
  type WorkflowNode,
  type WorkflowNodeKind,
} from "./types.ts";

export const WORKFLOW_KIND_LABEL: Record<WorkflowNodeKind, string> = {
  external: "External",
  gate: "Gate",
  step: "Step",
  store: "Store",
  system: "System",
};

export function workflowNodeKind(kind: WorkflowNode["kind"]): WorkflowNodeKind {
  return kind ?? "step";
}

export function workflowNodeHeight(
  node: Pick<WorkflowNode, "detail" | "tag">
): number {
  const detail = Boolean(node.detail?.trim());
  const tag = Boolean(node.tag?.trim());
  if (detail && tag) {
    return WORKFLOW_NODE_TAGGED;
  }
  if (detail || tag) {
    return WORKFLOW_NODE_DETAIL;
  }
  return WORKFLOW_NODE_HEIGHT;
}

export function workflowNodeSurface(kind: WorkflowNodeKind): string {
  if (kind === "gate") {
    return "border-status-warning/50 bg-card";
  }
  if (kind === "system") {
    return "border-border bg-muted";
  }
  if (kind === "store") {
    return "border-border bg-muted";
  }
  if (kind === "external") {
    return "border-border border-dashed bg-card";
  }
  return "border-border bg-card";
}

export function workflowKindFill(kind: WorkflowNodeKind): string {
  if (kind === "gate") {
    return "color-mix(in srgb, var(--status-danger-fg) 18%, var(--card))";
  }
  if (kind === "system") {
    return "color-mix(in srgb, var(--status-warning-fg) 18%, var(--card))";
  }
  if (kind === "store") {
    return "color-mix(in srgb, var(--status-success-fg) 18%, var(--card))";
  }
  if (kind === "external") {
    return "color-mix(in srgb, var(--muted-foreground) 12%, var(--card))";
  }
  return "color-mix(in srgb, var(--status-info-fg) 10%, var(--card))";
}

export function workflowKindStroke(kind: WorkflowNodeKind): string {
  if (kind === "gate") {
    return "var(--status-danger-fg)";
  }
  if (kind === "system") {
    return "var(--status-warning-fg)";
  }
  if (kind === "store") {
    return "var(--status-success-fg)";
  }
  if (kind === "external") {
    return "var(--muted-foreground)";
  }
  return "var(--status-info-fg)";
}

export function workflowLegendItems(
  nodes: readonly { kind: WorkflowNodeKind }[]
): WorkflowLegendItem[] {
  if (!nodes.some((node) => node.kind !== "step")) {
    return [];
  }
  const present = new Set(nodes.map((node) => node.kind));
  return WORKFLOW_NODE_KINDS.filter((kind) => present.has(kind)).map(
    (kind) => ({
      kind,
      label: WORKFLOW_KIND_LABEL[kind],
    })
  );
}
