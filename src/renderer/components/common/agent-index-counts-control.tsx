import { Button } from "@pier/ui/button.tsx";
import { agentIndexCounts } from "@shared/contracts/agent-runtime-index.ts";
import i18next from "i18next";
import type { ReactNode } from "react";
import { openAgentIndexQuickPick } from "@/lib/actions/agent-runtime-actions.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";

/**
 * 本机 Agent Index 计数芯片 — mac 标题栏与非 mac 顶栏共用。
 * Needs you / running；ready 不进 KPI。
 */
export function AgentIndexCountsControl(): ReactNode {
  const entries = useAgentRuntimeIndexStore((s) => s.entries);
  const { needsYou, running } = agentIndexCounts(entries);
  if (running === 0 && needsYou === 0) {
    return null;
  }

  return (
    <Button
      aria-label={i18next.t("agents.titleBar.countsAria", {
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
  );
}
