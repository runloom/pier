import type { WorkflowEdgeRole } from "./types.ts";

export function workflowEdgeRole(
  role: WorkflowEdgeRole | undefined
): WorkflowEdgeRole {
  return role ?? "main";
}

export function workflowEdgeStrokeVar(role: WorkflowEdgeRole): string {
  switch (role) {
    case "branch":
      return "var(--muted-foreground)";
    case "return":
      return "var(--status-warning-fg)";
    case "error":
      return "var(--status-danger-fg)";
    default:
      return "var(--status-info-fg)";
  }
}

/** Drop into the recovery band is a caution mark, not the heavy spine. */
export const SCREEN_FLOW_ROLE_ORDER = [
  "main",
  "branch",
  "return",
  "error",
] as const;

export function screenFlowUsedRoles(
  edges: readonly {
    readonly onMainPath: boolean;
    readonly role: WorkflowEdgeRole;
  }[]
): WorkflowEdgeRole[] {
  const used = new Set<WorkflowEdgeRole>();
  for (const edge of edges) {
    used.add(edge.onMainPath ? "main" : workflowEdgeRole(edge.role));
  }
  return SCREEN_FLOW_ROLE_ORDER.filter((role) => used.has(role));
}

export function workflowPaintRole(
  onMainPath: boolean,
  role: WorkflowEdgeRole,
  fromException: boolean,
  toException: boolean
): WorkflowEdgeRole {
  if (!fromException && toException) {
    return "error";
  }
  if (onMainPath) {
    return "main";
  }
  return workflowEdgeRole(role);
}
