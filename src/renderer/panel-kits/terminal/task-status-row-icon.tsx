import { cn } from "@pier/ui/utils.ts";
import type { TaskBackgroundRunSnapshot } from "@shared/contracts/tasks.ts";
import { Ban, CheckCircle2, Circle, CircleAlert, Loader2 } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";

export type TaskRowStatus = TaskBackgroundRunSnapshot["status"];

function taskStatusLabelKey(status: TaskRowStatus): string {
  switch (status) {
    case "blocked":
      return "terminal.taskStatus.statusBlocked";
    case "cancelled":
      return "terminal.taskStatus.statusCancelled";
    case "failed":
      return "terminal.taskStatus.statusFailed";
    case "pending":
      return "terminal.taskStatus.statusPending";
    case "running":
      return "terminal.taskStatus.statusRunning";
    case "succeeded":
      return "terminal.taskStatus.statusSucceeded";
    default:
      return "terminal.taskStatus.statusPending";
  }
}

export function TaskRowStatusIcon({
  status,
  testId,
}: {
  status: TaskRowStatus;
  testId: string;
}) {
  const t = useT();
  const label = t(taskStatusLabelKey(status));
  const commonClassName =
    "inline-flex size-4 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-3";
  const props = {
    "aria-label": label,
    "data-task-row-status": status,
    "data-testid": testId,
    title: label,
  };
  switch (status) {
    case "blocked":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-warning-fg)]")}
          {...props}
        >
          <CircleAlert
            aria-hidden="true"
            data-testid="task-status-row-blocked-icon"
          />
        </span>
      );
    case "cancelled":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-warning-fg)]")}
          {...props}
        >
          <Ban
            aria-hidden="true"
            data-testid="task-status-row-cancelled-icon"
          />
        </span>
      );
    case "failed":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-danger-fg)]")}
          {...props}
        >
          <CircleAlert
            aria-hidden="true"
            data-testid="task-status-row-failed-icon"
          />
        </span>
      );
    case "pending":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-neutral-fg)]")}
          {...props}
        >
          <Circle
            aria-hidden="true"
            data-testid="task-status-row-pending-icon"
          />
        </span>
      );
    case "running":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-info-fg)]")}
          {...props}
        >
          <Loader2
            aria-hidden="true"
            className="animate-spin"
            data-testid="task-status-row-running-icon"
          />
        </span>
      );
    case "succeeded":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-success-fg)]")}
          {...props}
        >
          <CheckCircle2
            aria-hidden="true"
            data-testid="task-status-row-succeeded-icon"
          />
        </span>
      );
    default:
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-neutral-fg)]")}
          {...props}
        >
          <Circle
            aria-hidden="true"
            data-testid="task-status-row-pending-icon"
          />
        </span>
      );
  }
}
