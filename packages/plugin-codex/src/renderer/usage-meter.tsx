import { Badge } from "@pier/ui/badge.tsx";
import {
  formatCount,
  formatDurationShort,
  formatPercent,
} from "@pier/ui/format.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { cn } from "@pier/ui/utils";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import type { CodexUsageWindow } from "../shared/accounts.ts";
import {
  remainingPercent,
  type UsageRisk,
  usageRisk,
} from "../shared/usage.ts";

export type Translate = (key: string, fallback: string) => string;

export interface UsageProgressProps {
  kind?: "additional" | "primary";
  label: string;
  language: string;
  position?: number;
  showLabel?: boolean;
  t: Translate;
  window: CodexUsageWindow;
}

function replace(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template
  );
}

export function usageWindowLabel(
  window: CodexUsageWindow,
  language: string,
  t: Translate
): string {
  const minutes = window.windowMinutes;
  let quota: string;
  if (!(minutes && Number.isFinite(minutes) && minutes > 0)) {
    quota = t("pier.codex.usage.quota", "Quota");
  } else if (minutes % 1440 === 0) {
    quota = replace(t("pier.codex.usage.quotaDays", "{count}-day quota"), {
      count: formatCount(minutes / 1440, language),
    });
  } else if (minutes % 60 === 0) {
    quota = replace(t("pier.codex.usage.quotaHours", "{count}-hour quota"), {
      count: formatCount(minutes / 60, language),
    });
  } else {
    quota = replace(
      t("pier.codex.usage.quotaMinutes", "{count}-minute quota"),
      { count: formatCount(minutes, language) }
    );
  }
  return window.limitName
    ? replace(t("pier.codex.usage.namedQuota", "{name} · {quota}"), {
        name: window.limitName,
        quota,
      })
    : quota;
}

function resetsLabel(
  window: CodexUsageWindow,
  now: number,
  language: string
): string | null {
  if (!window.resetsAt || window.resetsAt <= now) return null;
  return formatDurationShort(window.resetsAt - now, language);
}

export function usageProgressVariant(
  risk: UsageRisk
): "destructive" | "success" | "warning" {
  if (risk === "critical") return "destructive";
  if (risk === "warning") return "warning";
  return "success";
}

function riskLabel(risk: UsageRisk, t: Translate): string {
  if (risk === "critical") {
    return t("pier.codex.usage.risk.critical", "Critical");
  }
  if (risk === "warning") {
    return t("pier.codex.usage.risk.warning", "Warning");
  }
  return t("pier.codex.usage.risk.normal", "Normal");
}

export function UsageProgress({
  kind,
  label,
  language,
  position,
  showLabel = true,
  t,
  window,
}: UsageProgressProps): JSX.Element {
  const remaining = remainingPercent(window.usedPercent);
  const remainingLabel = formatPercent(remaining / 100, language);
  const risk = usageRisk(window.usedPercent);
  const reset = resetsLabel(window, Date.now(), language);

  return (
    <div
      className="codex:flex codex:min-w-0 codex:flex-col codex:gap-1.5"
      data-position={position}
      data-risk={risk}
      data-slot="codex-usage-progress"
      data-window-kind={kind}
    >
      <div className="codex:flex codex:items-center codex:justify-between codex:gap-3">
        {showLabel ? (
          <span
            className="pier-codex-font-medium codex:min-w-0 codex:truncate codex:text-xs"
            title={label}
          >
            {label}
          </span>
        ) : null}
        <span className="pier-codex-font-semibold pier-codex-tabular-nums pier-codex-tracking-tight codex:shrink-0 codex:text-lg">
          {remainingLabel}
        </span>
      </div>
      <Progress
        aria-label={`${label}: ${t("pier.codex.widget.remaining", "remaining")} ${remainingLabel}, ${riskLabel(risk, t)}`}
        className="codex:h-1"
        value={remaining}
        variant={usageProgressVariant(risk)}
      />
      {reset ? (
        <div className="codex:flex codex:min-w-0 codex:items-center codex:justify-between codex:gap-2 codex:text-muted-foreground codex:text-xs">
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
          <span className="pier-codex-tabular-nums codex:truncate codex:text-right">
            {t("pier.codex.widget.resetsIn", "Resets in")} {reset}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export interface UsageMeterProps {
  className?: string;
  language: string;
  t: Translate;
  windows: CodexUsageWindow[];
}

/** 保持服务端桶顺序，并确保首个（主）桶内周期从短到长。 */
export function sortUsageWindows(
  windows: readonly CodexUsageWindow[]
): CodexUsageWindow[] {
  const firstLimitId = windows[0]?.limitId;
  const limitOrder = new Map<string, number>();
  for (const window of windows) {
    if (!limitOrder.has(window.limitId)) {
      limitOrder.set(window.limitId, limitOrder.size);
    }
  }
  return windows
    .map((window, index) => ({ index, window }))
    .sort((left, right) => {
      const leftPrimary = left.window.limitId === firstLimitId;
      const rightPrimary = right.window.limitId === firstLimitId;
      if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
      const bucketOrder =
        (limitOrder.get(left.window.limitId) ?? 0) -
        (limitOrder.get(right.window.limitId) ?? 0);
      if (bucketOrder !== 0) return bucketOrder;
      const durationOrder =
        (left.window.windowMinutes ?? Number.POSITIVE_INFINITY) -
        (right.window.windowMinutes ?? Number.POSITIVE_INFINITY);
      return durationOrder || left.index - right.index;
    })
    .map(({ window }) => window);
}

export function UsageMeter({
  className,
  language,
  t,
  windows,
}: UsageMeterProps): JSX.Element {
  if (windows.length === 0) {
    return (
      <WidgetEmpty
        title={t("pier.codex.widget.noUsage", "No usage data available yet.")}
      />
    );
  }

  const sorted = sortUsageWindows(windows);
  const primaryLimitId = sorted[0]?.limitId;
  const primary = sorted.filter((window) => window.limitId === primaryLimitId);
  const additional = sorted.filter(
    (window) => window.limitId !== primaryLimitId
  );

  const renderGroup = (
    group: CodexUsageWindow[],
    kind: "additional" | "primary"
  ): JSX.Element => (
    <div
      className={cn(
        "codex:grid codex:min-w-0 codex:@[22rem]:grid-cols-2 codex:grid-cols-1 codex:@[34rem]:gap-4 codex:gap-3",
        kind === "additional" && "codex:@[34rem]:grid codex:hidden"
      )}
      data-window-group={kind}
    >
      {kind === "additional" ? (
        <div className="codex:col-span-full codex:flex codex:items-center codex:gap-2">
          <p className="codex:shrink-0 codex:text-muted-foreground codex:text-xs">
            {t("pier.codex.widget.modelQuotas", "Model-specific quotas")}
          </p>
          <Separator className="codex:flex-1" />
        </div>
      ) : null}
      {group.map((window, position) => (
        <UsageProgress
          key={window.id}
          kind={kind}
          label={usageWindowLabel(window, language, t)}
          language={language}
          position={position}
          t={t}
          window={window}
        />
      ))}
    </div>
  );

  return (
    <div
      className={cn(
        "codex:flex codex:min-w-0 codex:flex-col codex:gap-4",
        "pier-codex-usage-meter",
        className
      )}
      data-slot="codex-usage-meter"
    >
      {renderGroup(primary, "primary")}
      {additional.length > 0 ? renderGroup(additional, "additional") : null}
    </div>
  );
}
