import type { PanelTabStatus } from "@shared/contracts/panel.ts";
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
        textClassName: "text-primary",
      };
    case "succeeded":
      return {
        Icon: CircleCheckIcon,
        iconClassName: "",
        textClassName: "text-[var(--status-success-fg)]",
      };
    case "failed":
      return {
        Icon: OctagonXIcon,
        iconClassName: "",
        textClassName: "text-[var(--status-danger-fg)]",
      };
    case "waiting":
    case "blocked":
      return {
        Icon: TriangleAlertIcon,
        iconClassName: "",
        textClassName: "text-[var(--status-warning-fg)]",
      };
    case "cancelled":
      return {
        Icon: BanIcon,
        iconClassName: "",
        textClassName: "text-[var(--status-warning-fg)]",
      };
    case "idle":
      return {
        Icon: CircleCheckIcon,
        iconClassName: "",
        textClassName: "text-[var(--status-neutral-fg)]",
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
