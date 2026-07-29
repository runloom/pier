import { Badge } from "@pier/ui/badge.tsx";
import {
  COLLECTION_QUOTA_ITEM_MIN_WIDTH,
  collectionAutoFitClassName,
  collectionAutoFitStyle,
  collectionLayoutMode,
  type WidgetDensity,
} from "@pier/ui/collection-auto-layout.ts";
import {
  formatCount,
  formatCurrency,
  formatDurationShort,
  formatPercent,
} from "@pier/ui/format.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { cn } from "@pier/ui/utils";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import type {
  AccountUsageMetric,
  AccountUsageQuotaMetric,
  AccountUsageScalarMetric,
} from "./usage-cache.ts";

export interface AccountUsageMetricsCopy {
  noUsage: string;
  remaining: string;
  resetsIn: (duration: string) => string;
  risk?: {
    critical: string;
    warning: string;
  };
  stale: (duration: string) => string;
}

export interface AccountUsageMetricsProps {
  className?: string;
  copy: AccountUsageMetricsCopy;
  density?: WidgetDensity;
  language: string;
  metricLabel: (metric: AccountUsageMetric) => string;
  metrics: readonly AccountUsageMetric[];
  now?: number;
  status: "error" | "ok";
  updatedAt?: number;
}

function remainingPercent(usedPercent: number): number {
  return Math.round(Math.min(100, Math.max(0, 100 - usedPercent)));
}

function quotaVariant(
  metric: AccountUsageQuotaMetric
): "destructive" | "success" | "warning" {
  if (metric.availability === "blocked" || metric.usedPercent >= 90) {
    return "destructive";
  }
  if (metric.usedPercent >= 75) {
    return "warning";
  }
  return "success";
}

function formatScalar(
  metric: AccountUsageScalarMetric,
  language: string
): string {
  if (metric.format === "currency") {
    return formatCurrency(metric.value, language, metric.currency ?? "USD");
  }
  if (metric.format === "count") {
    return formatCount(metric.value, language);
  }
  return new Intl.NumberFormat(language).format(metric.value);
}

function ScalarMetrics({
  language,
  metricLabel,
  metrics,
}: {
  language: string;
  metricLabel: (metric: AccountUsageMetric) => string;
  metrics: readonly AccountUsageScalarMetric[];
}): JSX.Element | null {
  if (metrics.length === 0) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      data-slot="account-usage-scalars"
    >
      {metrics.map((metric) => (
        <Badge key={metric.id} size="xs" variant="neutral">
          {metricLabel(metric)} {formatScalar(metric, language)}
        </Badge>
      ))}
    </div>
  );
}

function QuotaMetric({
  copy,
  density,
  language,
  metric,
  metricLabel,
  now,
}: {
  copy: AccountUsageMetricsCopy;
  density: WidgetDensity;
  language: string;
  metric: AccountUsageQuotaMetric;
  metricLabel: (metric: AccountUsageMetric) => string;
  now: number;
}): JSX.Element {
  const label = metricLabel(metric);
  const remaining = remainingPercent(metric.usedPercent);
  const remainingLabel = formatPercent(remaining / 100, language);
  const variant = quotaVariant(metric);
  const reset =
    metric.resetsAt !== undefined && metric.resetsAt > now
      ? copy.resetsIn(formatDurationShort(metric.resetsAt - now, language))
      : null;
  let riskLabel: string | undefined;
  if (variant === "destructive") {
    riskLabel = copy.risk?.critical;
  } else if (variant === "warning") {
    riskLabel = copy.risk?.warning;
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col",
        density === "compact" ? "gap-1" : "gap-1.5"
      )}
      data-group-id={metric.groupId}
      data-metric-id={metric.id}
      data-slot="account-usage-quota"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-xs" title={label}>
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span className="text-muted-foreground text-xs">
            {copy.remaining}
          </span>
          <span
            className={cn(
              "font-semibold tabular-nums tracking-tight",
              density === "compact" ? "text-base" : "text-lg"
            )}
          >
            {remainingLabel}
          </span>
        </span>
      </div>
      <Progress
        aria-label={`${label}: ${copy.remaining} ${remainingLabel}`}
        className="h-1"
        value={remaining}
        variant={variant}
      />
      {reset || riskLabel ? (
        <div className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground text-xs">
          {riskLabel ? (
            <Badge
              size="xs"
              variant={variant === "destructive" ? "danger" : "warning"}
            >
              {riskLabel}
            </Badge>
          ) : (
            <span />
          )}
          {reset ? (
            <span className="truncate text-right tabular-nums">{reset}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AccountUsageMetrics({
  className,
  copy,
  density = "full",
  language,
  metricLabel,
  metrics,
  now = Date.now(),
  status,
  updatedAt,
}: AccountUsageMetricsProps): JSX.Element {
  const quotas = metrics.filter(
    (metric): metric is AccountUsageQuotaMetric => metric.kind === "quota"
  );
  const scalars = metrics.filter(
    (metric): metric is AccountUsageScalarMetric => metric.kind === "scalar"
  );
  if (metrics.length === 0) {
    return <WidgetEmpty title={copy.noUsage} />;
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        density === "compact" ? "gap-2" : "gap-3",
        className
      )}
      data-density={density}
      data-slot="account-usage-metrics"
    >
      {status === "error" && updatedAt !== undefined && updatedAt < now ? (
        <Badge className="w-fit" size="xs" variant="warning">
          {copy.stale(formatDurationShort(now - updatedAt, language))}
        </Badge>
      ) : null}
      {quotas.length > 0 ? (
        <div
          className={collectionAutoFitClassName(quotas.length, {
            gapClassName: density === "compact" ? "gap-2" : "gap-3",
            singleAs: "flex",
          })}
          data-count={quotas.length}
          data-layout={collectionLayoutMode(quotas.length)}
          data-slot="account-usage-quotas"
          style={collectionAutoFitStyle(
            quotas.length,
            COLLECTION_QUOTA_ITEM_MIN_WIDTH
          )}
        >
          {quotas.map((metric) => (
            <QuotaMetric
              copy={copy}
              density={density}
              key={metric.id}
              language={language}
              metric={metric}
              metricLabel={metricLabel}
              now={now}
            />
          ))}
        </div>
      ) : null}
      <ScalarMetrics
        language={language}
        metricLabel={metricLabel}
        metrics={scalars}
      />
    </div>
  );
}
