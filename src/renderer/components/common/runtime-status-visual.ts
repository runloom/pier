import type { PanelTabStatus } from "@shared/contracts/panel.ts";
import type { TaskRunNodeStatus } from "@shared/contracts/tasks.ts";
import {
  BanIcon,
  CircleCheckIcon,
  Loader2Icon,
  type LucideIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";

interface RuntimeStatusVisual {
  Icon: LucideIcon;
  iconClassName: string;
  textClassName: string;
}

export function runtimeStatusColorClassName(
  status: PanelTabStatus | TaskRunNodeStatus,
  priority: "normal" | "important" = "normal"
): string {
  switch (status) {
    case "pending":
    case "running":
      return priority === "important"
        ? "text-status-info-fg!"
        : "text-status-info-fg";
    case "succeeded":
      return priority === "important"
        ? "text-status-success-fg!"
        : "text-status-success-fg";
    case "failed":
      return priority === "important"
        ? "text-status-danger-fg!"
        : "text-status-danger-fg";
    case "waiting":
    case "stopping":
    case "blocked":
    case "cancelled":
      return priority === "important"
        ? "text-status-warning-fg!"
        : "text-status-warning-fg";
    case "idle":
      return priority === "important"
        ? "text-status-neutral-fg!"
        : "text-status-neutral-fg";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function runtimeStatusLabel(status: PanelTabStatus): string {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "waiting":
      return "Waiting";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function runtimeStatusVisual(
  status: PanelTabStatus
): RuntimeStatusVisual {
  switch (status) {
    case "running":
      return {
        Icon: Loader2Icon,
        iconClassName: "animate-spin motion-reduce:animate-none",
        textClassName: runtimeStatusColorClassName(status),
      };
    case "succeeded":
      return {
        Icon: CircleCheckIcon,
        iconClassName: "",
        textClassName: runtimeStatusColorClassName(status),
      };
    case "failed":
      return {
        Icon: OctagonXIcon,
        iconClassName: "",
        textClassName: runtimeStatusColorClassName(status),
      };
    case "waiting":
    case "blocked":
      return {
        Icon: TriangleAlertIcon,
        iconClassName: "",
        textClassName: runtimeStatusColorClassName(status),
      };
    case "cancelled":
      return {
        Icon: BanIcon,
        iconClassName: "",
        textClassName: runtimeStatusColorClassName(status),
      };
    case "idle":
      return {
        Icon: CircleCheckIcon,
        iconClassName: "",
        textClassName: runtimeStatusColorClassName(status),
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
