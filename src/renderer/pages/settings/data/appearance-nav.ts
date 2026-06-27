import {
  Keyboard,
  type LucideIcon,
  Paintbrush,
  Plug,
  Terminal,
} from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  id: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "appearance", icon: Paintbrush },
  { id: "terminal", icon: Terminal },
  { id: "keybindings", icon: Keyboard },
  { id: "plugins", icon: Plug },
] as const;

export type SettingsSectionId = (typeof NAV_ITEMS)[number]["id"];
