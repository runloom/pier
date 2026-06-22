import { type LucideIcon, Paintbrush } from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  id: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "appearance", label: "外观", icon: Paintbrush },
] as const;
