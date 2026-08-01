import type {
  AccountUsageMetric,
  AccountUsageQuotaMetric,
} from "@pier/plugin-api/account-usage";
import { AccountUsageMetrics } from "@pier/plugin-api/account-usage/renderer";
import type { WidgetDensity } from "@pier/ui/collection-auto-layout.ts";
import { formatCount } from "@pier/ui/format.tsx";
import type { JSX } from "react";

export type Translate = (key: string, fallback: string) => string;

function replace(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template
  );
}

export function usageWindowLabel(
  metric: AccountUsageQuotaMetric,
  language: string,
  t: Translate
): string {
  const minutes = metric.windowMinutes;
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
  return metric.name
    ? replace(t("pier.codex.usage.namedQuota", "{name} · {quota}"), {
        name: metric.name,
        quota,
      })
    : quota;
}

export function usageMetricLabel(
  metric: AccountUsageMetric,
  language: string,
  t: Translate
): string {
  if (metric.kind === "quota") {
    return usageWindowLabel(metric, language, t);
  }
  if (metric.id === "codex:reset-credits") {
    return t("pier.codex.usage.resetCredits", "Quota resets");
  }
  return metric.name ?? t("pier.codex.usage.value", "Usage value");
}

export interface UsageMeterProps {
  className?: string;
  density?: WidgetDensity;
  language: string;
  metrics: readonly AccountUsageMetric[];
  status: "error" | "ok";
  t: Translate;
  updatedAt?: number;
}

export function UsageMeter({
  className,
  density,
  language,
  metrics,
  status,
  t,
  updatedAt,
}: UsageMeterProps): JSX.Element {
  return (
    <AccountUsageMetrics
      {...(className === undefined ? {} : { className })}
      {...(density === undefined ? {} : { density })}
      copy={{
        noUsage: t("pier.codex.widget.noUsage", "No usage data available yet."),
        remaining: t("pier.codex.widget.remaining", "remaining"),
        resetsIn: (duration) =>
          replace(t("pier.codex.widget.resetsIn", "Resets in {duration}"), {
            duration,
          }),
        risk: {
          critical: t("pier.codex.usage.risk.critical", "Critical"),
          warning: t("pier.codex.usage.risk.warning", "Warning"),
        },
        stale: (duration) =>
          replace(
            t("pier.codex.widget.stale", "Showing data from {duration} ago"),
            { duration }
          ),
      }}
      language={language}
      metricLabel={(metric) => usageMetricLabel(metric, language, t)}
      metrics={metrics}
      status={status}
      {...(updatedAt === undefined ? {} : { updatedAt })}
    />
  );
}
