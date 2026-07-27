import { Checkbox } from "@pier/ui/checkbox.tsx";
import { cn } from "@pier/ui/utils.ts";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { SkillEffectiveCell } from "@shared/contracts/project-skills.ts";
import { resolveSkillDelivery } from "@shared/contracts/project-skills.ts";
import {
  PIER_DISCOVERY_CHANNELS,
  type PierDiscoveryChannelId,
} from "@shared/project-skills-pier-channels.ts";
import { useId } from "react";
import type { Translate } from "./skills-shared.tsx";

/**
 * Fixed two-row discovery-channel editor for managed skill detail.
 * Checkbox = publish this skill via that Pier projection root.
 * Detail shows path identity; list summaries stay icons-only.
 */
export function SkillsDiscoveryChannelEditor({
  disabled,
  effects,
  enabled,
  onChannelChange,
  projectDelivery,
  skillDelivery,
  t,
}: {
  disabled?: boolean;
  effects: readonly SkillEffectiveCell[];
  enabled: boolean;
  onChannelChange: (channel: PierDiscoveryChannelId, checked: boolean) => void;
  projectDelivery: { agents: boolean; claude: boolean };
  skillDelivery: { agents: boolean; claude: boolean } | null;
  t: Translate;
}) {
  const installed = new Set(
    effects
      .filter(
        (cell) =>
          cell.effect.state !== "agent-not-installed" &&
          cell.effect.state !== "not-applicable"
      )
      .map((cell) => cell.agentKind)
  );
  const channels = resolveSkillDelivery({
    enabled,
    projectDelivery,
    skillDelivery,
  });

  return (
    <div className="flex flex-col gap-3">
      {PIER_DISCOVERY_CHANNELS.map((channel) => {
        const checked =
          channel.id === "agents" ? channels.agents : channels.claude;
        const kinds = channel.agentKinds.filter((kind) => installed.has(kind));
        const displayKinds = kinds.length > 0 ? kinds : channel.agentKinds;
        return (
          <DiscoveryChannelRow
            checked={checked}
            count={displayKinds.length}
            {...(disabled === undefined ? {} : { disabled })}
            icons={displayKinds}
            key={channel.id}
            lit={checked}
            onCheckedChange={(next) => {
              onChannelChange(channel.id, next);
            }}
            root={channel.root}
            t={t}
          />
        );
      })}
    </div>
  );
}

function DiscoveryChannelRow({
  checked,
  count,
  disabled,
  icons,
  lit,
  onCheckedChange,
  root,
  t,
}: {
  checked: boolean;
  count: number;
  disabled?: boolean;
  icons: readonly AgentKind[];
  lit: boolean;
  onCheckedChange: (checked: boolean) => void;
  root: string;
  t: Translate;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Checkbox
        checked={checked}
        className="mt-0.5"
        disabled={disabled}
        id={id}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <label
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1"
        htmlFor={id}
      >
        <span className="text-muted-foreground text-xs">
          {t("settings.skills.discoveryChannelSummary", {
            count,
            path: root,
          })}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {icons.map((agentKind) => (
            <span
              aria-label={getAgentCatalogEntry(agentKind)?.label ?? agentKind}
              className={cn(
                "inline-flex size-5 items-center justify-center",
                !lit && "opacity-35 grayscale"
              )}
              key={agentKind}
              role="img"
            >
              <AgentIcon agentId={agentKind} size={14} />
            </span>
          ))}
        </span>
      </label>
    </div>
  );
}
