import { Spinner } from "@pier/ui/spinner.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { TaskRunNodeStatus } from "@shared/contracts/tasks.ts";
import { Ban, CircleCheck, OctagonX, TriangleAlert } from "lucide-react";
import { runtimeStatusColorClassName } from "@/components/common/runtime-status-visual.ts";

export function terminalRuntimeStatusLabelKey(status: TaskRunNodeStatus) {
  return `terminal.runtimeControl.${status}` as const;
}

export function TerminalRuntimeStatusIcon({
  status,
}: {
  status: TaskRunNodeStatus;
}) {
  const className = cn("size-4 shrink-0", runtimeStatusColorClassName(status));
  switch (status) {
    case "running":
    case "stopping":
      return (
        <Spinner
          aria-hidden="true"
          className={cn(className, "motion-reduce:animate-none")}
        />
      );
    case "succeeded":
      return <CircleCheck aria-hidden="true" className={className} />;
    case "failed":
      return <OctagonX aria-hidden="true" className={className} />;
    case "blocked":
      return <TriangleAlert aria-hidden="true" className={className} />;
    case "cancelled":
      return <Ban aria-hidden="true" className={className} />;
    default:
      return (
        <Spinner
          aria-hidden="true"
          className={cn(className, "motion-reduce:animate-none")}
        />
      );
  }
}
