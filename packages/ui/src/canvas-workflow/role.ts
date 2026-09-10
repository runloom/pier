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
