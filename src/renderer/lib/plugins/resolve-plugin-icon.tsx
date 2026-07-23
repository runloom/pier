/**
 * Resolve the display icon for a plugin id.
 *
 * Order: builtin module.icon → first-party brand/semantic map → Puzzle.
 * Managed external plugins (Codex / Claude / Grok / SSH) are not in the
 * builtin catalog, so without this map settings nav falls back to Puzzle for
 * every entry.
 */

import { cn } from "@pier/ui/utils.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { Puzzle, Server } from "lucide-react";
import type { ComponentType } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { getBuiltinRendererPluginModule } from "./builtin-catalog.ts";

export type PluginDisplayIcon = ComponentType<{
  className?: string;
  size?: number | string;
}>;

function agentBrandIcon(agentId: AgentKind): PluginDisplayIcon {
  function AgentBrandIcon({
    className,
    size = 16,
  }: {
    className?: string;
    size?: number | string;
  }) {
    const px = typeof size === "number" ? size : 16;
    return (
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center",
          className
        )}
      >
        <AgentIcon agentId={agentId} size={px} />
      </span>
    );
  }
  return AgentBrandIcon;
}

/** Official managed plugins that ship with Pier — brand or domain icons. */
const FIRST_PARTY_PLUGIN_ICONS: Readonly<Record<string, PluginDisplayIcon>> = {
  "pier.claude": agentBrandIcon("claude"),
  "pier.codex": agentBrandIcon("codex"),
  "pier.grok": agentBrandIcon("grok"),
  "pier.ssh": Server,
};

export function resolvePluginIcon(pluginId: string): PluginDisplayIcon {
  const builtin = getBuiltinRendererPluginModule(pluginId)?.icon;
  if (builtin) {
    return builtin;
  }
  return FIRST_PARTY_PLUGIN_ICONS[pluginId] ?? Puzzle;
}
