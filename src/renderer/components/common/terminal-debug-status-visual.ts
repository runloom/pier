export type TerminalDebugRouteStatus = "bad" | "idle" | "ok" | "warn";

export function terminalDebugStatusClass(
  status: TerminalDebugRouteStatus
): string {
  if (status === "ok") {
    return "border-border border-l-4 border-l-success bg-card text-status-success-fg";
  }
  if (status === "warn") {
    return "border-border border-l-4 border-l-warning bg-card text-status-warning-fg";
  }
  if (status === "bad") {
    return "border-border border-l-4 border-l-destructive bg-card text-status-danger-fg";
  }
  return "border-border border-l-4 border-l-border bg-card text-muted-foreground";
}

export function terminalDebugStatusFill(
  status: TerminalDebugRouteStatus
): string {
  if (status === "ok") {
    return "bg-success";
  }
  if (status === "warn") {
    return "bg-warning";
  }
  if (status === "bad") {
    return "bg-destructive";
  }
  return "bg-muted-foreground/40";
}

export function terminalDebugStatusWord(
  status: TerminalDebugRouteStatus
): string {
  if (status === "ok") {
    return "ok";
  }
  if (status === "warn") {
    return "stale";
  }
  if (status === "bad") {
    return "blocked";
  }
  return "idle";
}
