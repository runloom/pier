import { formatDurationShort } from "@pier/ui/format.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { AgentRuntimeIndexEntry } from "@shared/contracts/agent-runtime-index.ts";
import { isAgentIndexNeedsYou } from "@shared/contracts/agent-runtime-index.ts";
import i18next from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { AgentStatusLabel } from "@/components/agent-status/agent-status-label.tsx";
import { resolveAgentIndexDisplayStatus } from "@/lib/agent-runtime/agent-index-display-status.ts";
import type { QuickPickItem } from "@/lib/command-palette/types.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

const DURATION_TICK_MS = 1000;

function durationLabel(
  status: AgentRuntimeIndexEntry["status"],
  stateStartedAt: number | undefined,
  now: number
): string | undefined {
  if (status === undefined || stateStartedAt === undefined) {
    return;
  }
  const elapsed = Math.max(0, now - stateStartedAt);
  const locale = i18next.language?.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en";
  return formatDurationShort(elapsed, locale);
}

/**
 * Agent Index QuickPick 行：品牌图标 + 标题 + 终端同源状态文案（无状态点）。
 * 本窗 status / 子代理数订 FA；时长每秒刷新。
 */
export function AgentIndexQuickPickRow({
  item,
}: {
  item: QuickPickItem;
}): ReactNode {
  const entry = item.data as AgentRuntimeIndexEntry | undefined;
  const localActivity = useForegroundActivityStore((state) =>
    entry ? state.activities[entry.panelId] : undefined
  );
  const display = entry
    ? resolveAgentIndexDisplayStatus(entry, localActivity)
    : undefined;
  const status = display?.status;
  const stateStartedAt = display?.stateStartedAt;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (status === undefined || stateStartedAt === undefined) {
      return;
    }
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), DURATION_TICK_MS);
    return () => clearInterval(id);
  }, [status, stateStartedAt]);

  const destructive =
    item.variant === "destructive" ||
    (status !== undefined && isAgentIndexNeedsYou(status));
  const showAgentIcon = entry !== undefined;
  const FallbackIcon = item.icon;
  const duration =
    entry === undefined
      ? undefined
      : durationLabel(status, stateStartedAt, nowMs);
  let trailingMeta: string | undefined = duration;
  if (trailingMeta === undefined && !entry && item.description) {
    trailingMeta = item.description;
  }

  let leadingIcon: ReactNode = null;
  if (showAgentIcon && entry) {
    leadingIcon = <AgentIcon agentId={entry.agentId} size={16} />;
  } else if (FallbackIcon) {
    leadingIcon = (
      <FallbackIcon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          destructive ? "text-destructive" : "text-muted-foreground"
        )}
      />
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      {leadingIcon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate font-medium text-sm/tight",
              destructive && "text-destructive"
            )}
          >
            {item.label}
          </span>
          {entry ? (
            <AgentStatusLabel
              fallbackLabel={i18next.t("agents.section.running")}
              spawnedAt={display?.spawnedAt}
              stateStartedAt={stateStartedAt}
              status={status}
              subagentCount={display?.subagentCount ?? 0}
            />
          ) : null}
        </span>
        {item.detail ? (
          <span className="truncate text-muted-foreground text-xs/tight">
            {item.detail}
          </span>
        ) : null}
      </span>
      {trailingMeta ? (
        <span className="min-w-0 max-w-[45%] shrink truncate text-right text-muted-foreground text-xs/tight tabular-nums">
          {trailingMeta}
        </span>
      ) : null}
    </span>
  );
}
