import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type {
  McpAgentEffectCell,
  McpGap,
} from "@shared/contracts/agent/assets.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { useT } from "@/i18n/use-t.ts";

export function agentLabel(agentKind: string): string {
  return getAgentCatalogEntry(agentKind as AgentKind)?.label ?? agentKind;
}

export function McpAvailabilitySummary({
  effects,
  gaps,
  t,
}: {
  effects: readonly McpAgentEffectCell[];
  gaps: readonly McpGap[];
  t: ReturnType<typeof useT>;
}) {
  const discoverable = effects.filter(
    (cell) => cell.effect.state === "discoverable"
  );
  const gapLabels = gaps.map((gap) => agentLabel(gap.agentKind));
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {discoverable.length === 0 ? (
        <span className="text-muted-foreground text-xs">
          {t("settings.projects.mcpAvailableNone")}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {discoverable.map((cell) => (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground text-xs"
              key={cell.agentKind}
            >
              <AgentIcon agentId={cell.agentKind as AgentKind} size={14} />
              <span>{agentLabel(cell.agentKind)}</span>
            </span>
          ))}
        </span>
      )}
      {gapLabels.length > 0 ? (
        <span className="text-muted-foreground text-xs">
          {t("settings.projects.mcpGaps", { agents: gapLabels.join(" · ") })}
        </span>
      ) : null}
    </span>
  );
}
