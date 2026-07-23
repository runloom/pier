import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  Bell,
  Bot,
  Box,
  Download,
  FolderGit2,
  Keyboard,
  type LucideIcon,
  Paintbrush,
  Plug,
  Terminal,
} from "lucide-react";
import type { ComponentType } from "react";
import { resolvePluginConfigurationTitle } from "@/lib/plugins/display.ts";
import { resolvePluginIcon } from "@/lib/plugins/resolve-plugin-icon.tsx";

export interface StaticNavItem {
  icon: LucideIcon;
  id: string;
  variant: "static";
}

export interface PluginNavItem {
  icon: ComponentType<{ className?: string; size?: number | string }>;
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
  { id: "agents", icon: Bot, variant: "static" },
  { id: "notifications", icon: Bell, variant: "static" },
  // projects: 项目级配置壳（环境 + 技能）；旧 environment/skills 深链仍可用。
  { id: "projects", icon: Box, variant: "static" },
  // workspace: 宿主级工作区偏好(worktree 目录等)；紧挨项目，便于对照项目与工作区配置。
  { id: "workspace", icon: FolderGit2, variant: "static" },
  { id: "plugins", icon: Plug, variant: "static" },
  { id: "updates", icon: Download, variant: "static" },
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

/**
 * 插件导航项：已启用且声明 configuration 或 settingsPages 的插件；icon 经
 * {@link resolvePluginIcon}（builtin module → 官方受管品牌图 → Puzzle）。
 */
export function pluginNavItems(
  entries: readonly PluginRegistryEntry[],
  locale: string
): PluginNavItem[] {
  return entries
    .filter(
      (entry) =>
        entry.runtime.enabled &&
        (Boolean(entry.manifest.configuration) ||
          entry.manifest.settingsPages.length > 0)
    )
    .map((entry) => ({
      icon: resolvePluginIcon(entry.manifest.id),
      id: pluginSectionId(entry.manifest.id),
      label: resolvePluginConfigurationTitle(entry, locale),
      pluginId: entry.manifest.id,
      variant: "plugin" as const,
    }));
}
