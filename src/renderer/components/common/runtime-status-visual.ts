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
  status: PanelTabStatus | TaskRunNodeStatus
): string {
  switch (status) {
    case "pending":
    case "running":
      return "text-status-info-fg";
    case "succeeded":
      return "text-status-success-fg";
    case "failed":
      return "text-status-danger-fg";
    case "waiting":
    case "stopping":
    case "blocked":
    case "cancelled":
      return "text-status-warning-fg";
    case "idle":
      return "text-status-neutral-fg";
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
