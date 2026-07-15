import { cn } from "@pier/ui/utils.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { AgentShimmerText } from "./agent-shimmer-text.tsx";
import {
  agentStatusTextKey,
  longRunLevel,
  shouldShimmer,
  statusColorVar,
} from "./agent-status-visual.ts";

const LONG_RUN_TICK_MS = 250;

export interface AgentStatusLabelProps {
  className?: string;
  /** launch 无 status 时：null 不渲染（状态栏 icon-only）；文案则由调用方自理 */
  fallbackLabel?: string;
  spawnedAt?: number;
  stateStartedAt?: number;
  status: ActivityStatus | undefined;
  subagentCount?: number;
}

/**
 * Agent 五态文案展示 —— 与终端状态栏同源（shimmer / 长跑色 / i18n key）。
 * 列表与状态栏共用，禁止再画一套 Badge 映射。
 */
export function AgentStatusLabel({
  className,
  fallbackLabel,
  spawnedAt,
  stateStartedAt,
  status,
  subagentCount = 0,
}: AgentStatusLabelProps) {
  const t = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const shimmer = status !== undefined && shouldShimmer(status);

  useEffect(() => {
    if (!shimmer) {
      return;
    }
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), LONG_RUN_TICK_MS);
    return () => clearInterval(id);
  }, [shimmer]);

  if (status === undefined) {
    if (fallbackLabel === undefined) {
      return null;
    }
    return (
      <span
        className={cn("whitespace-nowrap text-[11px]", className)}
        data-activity-badge
        data-agent-status="none"
      >
        <span data-activity-badge-text>{fallbackLabel}</span>
      </span>
    );
  }

  const label = t(agentStatusTextKey(status));
  const badge =
    subagentCount > 0
      ? `${label} · ${t("terminal.agentStatus.subagentCount", {
          count: subagentCount,
        })}`
      : label;

  if (shimmer) {
    const level = longRunLevel(
      Math.max(0, nowMs - (stateStartedAt ?? spawnedAt ?? nowMs))
    );
    const colorVar = statusColorVar(status, level);
    return (
      <span
        className={cn("whitespace-nowrap text-[11px]", className)}
        data-activity-badge
        data-agent-status={status}
      >
        <AgentShimmerText colorVar={colorVar} text={badge} />
      </span>
    );
  }

  return (
    <span
      className={cn("whitespace-nowrap text-[11px]", className)}
      data-activity-badge
      data-agent-status={status}
    >
      <span data-activity-badge-text>{badge}</span>
    </span>
  );
}
