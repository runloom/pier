import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  Bot,
  Keyboard,
  type LucideIcon,
  Paintbrush,
  Plug,
  Puzzle,
  Terminal,
} from "lucide-react";
import { resolvePluginConfigurationTitle } from "@/lib/plugins/display.ts";

export interface StaticNavItem {
  icon: LucideIcon;
  id: string;
  variant: "static";
}

export interface PluginNavItem {
  icon: LucideIcon;
  id: string;
  label: string;
  pluginId: string;
  variant: "plugin";
}

export type SettingsNavItem = PluginNavItem | StaticNavItem;

export const NAV_ITEMS: readonly StaticNavItem[] = [
  { id: "appearance", icon: Paintbrush, variant: "static" },
  { id: "terminal", icon: Terminal, variant: "static" },
  { id: "keybindings", icon: Keyboard, variant: "static" },
  { id: "plugins", icon: Plug, variant: "static" },
  { id: "agents", icon: Bot, variant: "static" },
] as const;

export type SettingsSectionId = string;

const PLUGIN_SECTION_PREFIX = "plugin:";

export function pluginSectionId(pluginId: string): SettingsSectionId {
  return `${PLUGIN_SECTION_PREFIX}${pluginId}`;
}

export function pluginIdFromSectionId(
  sectionId: SettingsSectionId
): string | null {
  return sectionId.startsWith(PLUGIN_SECTION_PREFIX)
    ? sectionId.slice(PLUGIN_SECTION_PREFIX.length)
    : null;
}

/** 插件导航项：已启用且声明 configuration 的插件；icon 统一 lucide Puzzle。 */
export function pluginNavItems(
  entries: readonly PluginRegistryEntry[],
  locale: string
): PluginNavItem[] {
  return entries
    .filter((entry) => entry.runtime.enabled && entry.manifest.configuration)
    .map((entry) => ({
      icon: Puzzle,
      id: pluginSectionId(entry.manifest.id),
      label: resolvePluginConfigurationTitle(entry, locale),
      pluginId: entry.manifest.id,
      variant: "plugin" as const,
    }));
}
