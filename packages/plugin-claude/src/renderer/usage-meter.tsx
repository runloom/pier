import { Badge } from "@pier/ui/badge.tsx";
import { formatDurationShort, formatPercent } from "@pier/ui/format.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { cn } from "@pier/ui/utils";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import type { ClaudeUsageWindow } from "../shared/accounts.ts";
import {
  remainingPercent,
  type UsageRisk,
  usageRisk,
} from "../shared/usage.ts";

export type Translate = (key: string, fallback: string) => string;

/**
 * Bucket label for the fixed Claude quota windows: the 5-hour session and
 * the 7-day all-model / per-model limits Claude Code's `/usage` shows.
 */
export function usageWindowLabel(
  window: ClaudeUsageWindow,
  t: Translate
): string {
  if (window.limitId === "session") {
    return t("pier.claude.usage.session", "Current session (5h)");
  }
  if (window.limitId === "weekly") {
    return t("pier.claude.usage.weekly", "Weekly limit");
  }
  if (window.limitId.startsWith("weekly:")) {
    const model = window.limitName ?? window.limitId.slice("weekly:".length);
    return `${model} · ${t("pier.claude.usage.weeklyScoped", "Weekly")}`;
  }
  return window.limitName ?? window.limitId;
}

function resetsLabel(
  window: ClaudeUsageWindow,
  now: number,
  language: string
): string | null {
  if (!window.resetsAt || window.resetsAt <= now) {
    return null;
  }
  return formatDurationShort(window.resetsAt - now, language);
}

export function usageProgressVariant(
  risk: UsageRisk
): "destructive" | "success" | "warning" {
  if (risk === "critical") {
    return "destructive";
  }
  if (risk === "warning") {
    return "warning";
  }
  return "success";
}

function riskLabel(risk: UsageRisk, t: Translate): string {
  if (risk === "critical") {
    return t("pier.claude.usage.risk.critical", "Critical");
  }
  if (risk === "warning") {
    return t("pier.claude.usage.risk.warning", "Warning");
  }
  return t("pier.claude.usage.risk.normal", "Normal");
}

export function UsageProgress({
  language,
  t,
  window,
}: {
  language: string;
  t: Translate;
  window: ClaudeUsageWindow;
}): JSX.Element {
  const label = usageWindowLabel(window, t);
  const remaining = remainingPercent(window.usedPercent);
  const remainingLabel = formatPercent(remaining / 100, language);
  const risk = usageRisk(window.usedPercent);
  const reset = resetsLabel(window, Date.now(), language);

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-1.5"
      data-limit-id={window.limitId}
      data-risk={risk}
      data-slot="claude-usage-progress"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-xs" title={label}>
          {label}
        </span>
        <span className="shrink-0 font-semibold text-lg tabular-nums tracking-tight">
          {remainingLabel}
        </span>
      </div>
      <Progress
        aria-label={`${label}: ${t("pier.claude.widget.remaining", "remaining")} ${remainingLabel}, ${riskLabel(risk, t)}`}
        className="h-1"
        value={remaining}
        variant={usageProgressVariant(risk)}
      />
      {reset ? (
        <div className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground text-xs">
          {risk === "normal" ? (
            <span />
          ) : (
            <Badge
              size="xs"
              variant={risk === "critical" ? "danger" : "warning"}
            >
              {riskLabel(risk, t)}
            </Badge>
          )}
          <span className="truncate text-right tabular-nums">
            {t("pier.claude.widget.resetsIn", "Resets in {duration}").replace(
              "{duration}",
              reset
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Session first, then weekly, then per-model weekly, preserving API order. */
export function sortUsageWindows(
  windows: readonly ClaudeUsageWindow[]
): ClaudeUsageWindow[] {
  const rank = (window: ClaudeUsageWindow): number => {
    if (window.limitId === "session") {
      return 0;
    }
    if (window.limitId === "weekly") {
      return 1;
    }
    return 2;
  };
  return windows
    .map((window, index) => ({ index, window }))
    .sort(
      (left, right) =>
        rank(left.window) - rank(right.window) || left.index - right.index
    )
    .map(({ window }) => window);
}

export function UsageMeter({
  className,
  language,
  t,
  windows,
}: {
  className?: string;
  language: string;
  t: Translate;
  windows: ClaudeUsageWindow[];
}): JSX.Element {
  if (windows.length === 0) {
    return (
      <WidgetEmpty
        title={t("pier.claude.widget.noUsage", "No usage data available yet.")}
      />
    );
  }

  const sorted = sortUsageWindows(windows);
  const single = sorted.length === 1;

  return (
    <div
      className={cn(
        "w-full min-w-0 content-start",
        "[--claude-quota-item-min-width:18rem]",
        single
          ? "flex flex-col gap-3"
          : "grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--claude-quota-item-min-width)),1fr))] gap-3",
        "pier-claude-usage-meter",
        className
      )}
      data-count={sorted.length}
      data-layout={single ? "single" : "auto-fit"}
      data-slot="claude-usage-meter"
    >
      {sorted.map((window) => (
        <UsageProgress
          key={window.id}
          language={language}
          t={t}
          window={window}
        />
      ))}
    </div>
  );
}
