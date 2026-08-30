import { Button } from "@pier/ui/button.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { agentIndexCounts } from "@shared/contracts/agent/runtime-index.ts";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t.ts";
import { openAgentIndexQuickPick } from "@/lib/actions/agent-runtime-actions.ts";
import { useActionKeybindingLabel } from "@/lib/keybindings/use-action-label.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";

/**
 * 本机 Agent Index 计数芯片 — mac 标题栏与非 mac 顶栏共用。
 * Needs you / running；ready 不进 KPI。
 */
export function AgentIndexCountsControl(): ReactNode {
  const t = useT();
  const entries = useAgentRuntimeIndexStore((s) => s.entries);
  const { needsYou, running } = agentIndexCounts(entries);
  const listShortcut = useActionKeybindingLabel("pier.agents.list");
  if (running === 0 && needsYou === 0) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={t("agents.titleBar.countsAria", {
            needsYou,
            running,
          })}
          className="app-no-drag"
          data-testid="titlebar-agent-counts"
          onClick={() => {
            openAgentIndexQuickPick({ limit: 8 }).catch(() => undefined);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {running > 0 && (
            <span className="flex items-center gap-1 text-status-info-fg">
              <span className="size-1.5 animate-pulse rounded-full bg-status-info-fg" />
              {running}
            </span>
          )}
          {needsYou > 0 && (
            <span className="flex items-center gap-1 font-medium text-status-warning-fg">
              <span className="size-1.5 rounded-full bg-status-warning-fg" />
              {needsYou}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t("agents.titleBar.tooltip")}
        {listShortcut ? <Kbd>{listShortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
