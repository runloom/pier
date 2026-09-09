import type { WorkflowEdgeRole } from "./types.ts";

export function workflowEdgeRole(
  role: WorkflowEdgeRole | undefined
): WorkflowEdgeRole {
  return role ?? "main";
}

/** Stroke / marker token. Cards stay neutral. */
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

/** Non-color cue so role is not hue-only. Main-path walks stay solid. */
export function workflowEdgeDash(
  role: WorkflowEdgeRole,
  onMainPath: boolean
): string | undefined {
  if (onMainPath) {
    return;
  }
  switch (role) {
    case "error":
      return "5 4";
    case "return":
      return "4 4";
    case "branch":
      return "5 4";
    default:
      return;
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
