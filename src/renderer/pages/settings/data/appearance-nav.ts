import { Keyboard, type LucideIcon, Paintbrush, Terminal } from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  id: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "appearance", label: "外观", icon: Paintbrush },
  { id: "terminal", label: "终端", icon: Terminal },
  { id: "keybindings", label: "快捷键", icon: Keyboard },
] as const;

export type SettingsSectionId = (typeof NAV_ITEMS)[number]["id"];
