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

function localizeName(name: string, t: Translate): string {
  if (name === "Weekly limit") {
    return t("pier.grok.usage.period.weekly", "Weekly limit");
  }
  if (name === "Monthly limit") {
    return t("pier.grok.usage.period.monthly", "Monthly limit");
  }
  if (name === "Monthly spend") {
    return t("pier.grok.usage.period.monthlySpend", "Monthly spend");
  }
  if (name === "API") return t("pier.grok.usage.product.api", "API");
  if (name === "Grok Build") {
    return t("pier.grok.usage.product.grokBuild", "Grok Build");
  }
  if (name === "On-demand") {
    return t("pier.grok.usage.onDemand", "On-demand");
  }
  if (name === "Frequent tasks") {
    return t("pier.grok.usage.frequentTasks", "Frequent tasks");
  }
  if (name === "Occasional tasks") {
    return t("pier.grok.usage.occasionalTasks", "Occasional tasks");
  }
  return name;
}

export function usageWindowLabel(
  metric: AccountUsageQuotaMetric,
  language: string,
  t: Translate
): string {
  const minutes = metric.windowMinutes;
  let quota: string;
  if (!(minutes && Number.isFinite(minutes) && minutes > 0)) {
    quota = t("pier.grok.usage.quota", "Quota");
  } else if (minutes % 1440 === 0) {
    quota = replace(t("pier.grok.usage.quotaDays", "{count}-day quota"), {
      count: formatCount(minutes / 1440, language),
    });
  } else if (minutes % 60 === 0) {
    quota = replace(t("pier.grok.usage.quotaHours", "{count}-hour quota"), {
      count: formatCount(minutes / 60, language),
    });
  } else {
    quota = replace(t("pier.grok.usage.quotaMinutes", "{count}-minute quota"), {
      count: formatCount(minutes, language),
    });
  }
  return metric.name
    ? replace(t("pier.grok.usage.namedQuota", "{name} · {quota}"), {
        name: localizeName(metric.name, t),
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
  if (metric.id === "grok:prepaid-balance") {
    return t("pier.grok.usage.prepaidBalance", "Prepaid balance");
  }
  if (metric.id === "grok:reset-credits") {
    return t("pier.grok.usage.resetCredits", "Quota resets");
  }
  return metric.name
    ? localizeName(metric.name, t)
    : t("pier.grok.usage.value", "Usage value");
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
        noUsage: t("pier.grok.widget.noUsage", "No usage data available yet."),
        remaining: t("pier.grok.widget.remaining", "remaining"),
        resetsIn: (duration) =>
          replace(t("pier.grok.widget.resetsIn", "Resets in {duration}"), {
            duration,
          }),
        risk: {
          critical: t("pier.grok.usage.risk.critical", "Critical"),
          warning: t("pier.grok.usage.risk.warning", "Warning"),
        },
        stale: (duration) =>
          replace(
            t("pier.grok.widget.stale", "Showing data from {duration} ago"),
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
