import { cn } from "@pier/ui/utils.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { useT } from "@/i18n/use-t.ts";
import { AgentShimmerText } from "./shimmer-text.tsx";
import { agentStatusTextKey, shouldShimmer } from "./visual.ts";

export interface AgentStatusLabelProps {
  className?: string | undefined;
  /** launch 无 status 时：null 不渲染（状态栏 icon-only）；文案则由调用方自理 */
  fallbackLabel?: string | undefined;
  status: ActivityStatus | undefined;
  subagentCount?: number | undefined;
}

/**
 * Agent 五态文案展示 —— 与终端状态栏同源（shimmer / i18n key）。
 * 列表与状态栏共用，禁止再画一套 Badge 映射。
 */
export function AgentStatusLabel({
  className,
  fallbackLabel,
  status,
  subagentCount = 0,
}: AgentStatusLabelProps) {
  const t = useT();

  if (status === undefined) {
    if (fallbackLabel === undefined) {
      return null;
    }
    return (
      <span
        className={cn("whitespace-nowrap text-xs", className)}
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

  return (
    <span
      className={cn("whitespace-nowrap text-xs", className)}
      data-activity-badge
      data-agent-status={status}
    >
      {shouldShimmer(status) ? (
        <AgentShimmerText text={badge} />
      ) : (
        <span data-activity-badge-text>{badge}</span>
      )}
    </span>
  );
}
