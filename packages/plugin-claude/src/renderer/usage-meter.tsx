import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import { AccountUsageMetrics } from "@pier/plugin-api/account-usage/renderer";
import type { WidgetDensity } from "@pier/ui/collection-auto-layout.ts";
import type { JSX } from "react";

export type Translate = (key: string, fallback: string) => string;

export function usageMetricLabel(
  metric: AccountUsageMetric,
  t: Translate
): string {
  if (metric.kind === "scalar") {
    if (metric.id === "claude:extra-usage-used") {
      return t("pier.claude.usage.extraUsageUsed", "Extra usage");
    }
    if (metric.id === "claude:extra-usage-limit") {
      return t("pier.claude.usage.extraUsageLimit", "Extra usage limit");
    }
    return metric.name ?? t("pier.claude.usage.value", "Usage value");
  }
  if (metric.groupId === "claude:session") {
    return t("pier.claude.usage.session", "Current session (5h)");
  }
  if (metric.groupId === "claude:weekly") {
    return t("pier.claude.usage.weekly", "Weekly limit");
  }
  if (metric.groupId.startsWith("claude:weekly:")) {
    const model = metric.name ?? metric.groupId.slice("claude:weekly:".length);
    return `${model} · ${t("pier.claude.usage.weeklyScoped", "Weekly")}`;
  }
  return metric.name ?? metric.groupId;
}

export function UsageMeter({
  className,
  density,
  language,
  metrics,
  status,
  t,
  updatedAt,
}: {
  className?: string;
  density?: WidgetDensity;
  language: string;
  metrics: readonly AccountUsageMetric[];
  status: "error" | "ok";
  t: Translate;
  updatedAt?: number;
}): JSX.Element {
  return (
    <AccountUsageMetrics
      {...(className === undefined ? {} : { className })}
      {...(density === undefined ? {} : { density })}
      copy={{
        noUsage: t(
          "pier.claude.widget.noUsage",
          "No usage data available yet."
        ),
        remaining: t("pier.claude.widget.remaining", "remaining"),
        resetsIn: (duration) =>
          t("pier.claude.widget.resetsIn", "Resets in {duration}").replace(
            "{duration}",
            duration
          ),
        risk: {
          critical: t("pier.claude.usage.risk.critical", "Critical"),
          warning: t("pier.claude.usage.risk.warning", "Warning"),
        },
        stale: (duration) =>
          t(
            "pier.claude.widget.stale",
            "Showing data from {duration} ago"
          ).replace("{duration}", duration),
      }}
      language={language}
      metricLabel={(metric) => usageMetricLabel(metric, t)}
      metrics={metrics}
      status={status}
      {...(updatedAt === undefined ? {} : { updatedAt })}
    />
  );
}
