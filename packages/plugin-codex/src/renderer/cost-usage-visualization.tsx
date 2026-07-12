import { Badge } from "@pier/ui/badge.tsx";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@pier/ui/chart.tsx";
import {
  formatCompactNumber,
  formatCount,
  formatCurrency,
} from "@pier/ui/format.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { JSX } from "react";
import { Bar, BarChart, type BarShapeProps, Rectangle, XAxis } from "recharts";
import type { CodexCostUsageSnapshot } from "../shared/accounts.ts";
import { COST_USAGE_PERIOD_DAYS } from "../shared/constants.ts";
import type { Translate } from "./usage-meter.tsx";

const COST_DAYS = Array.from(
  { length: COST_USAGE_PERIOD_DAYS },
  (_, index) => `cost-day-${index + 1}`
);

const COST_CHART_CONFIG = {
  cost: { color: "var(--chart-1)", label: "Cost" },
} satisfies ChartConfig;

function dataQuality(snapshot: CodexCostUsageSnapshot | null | undefined) {
  const unpricedDays =
    snapshot?.buckets.filter((bucket) => bucket.pricingStatus !== "complete")
      .length ?? 0;
  return {
    diagnostics: snapshot?.diagnostics,
    incompleteCoverage: Boolean(snapshot && !snapshot.coverage.complete),
    partiallyUnpriced: Boolean(snapshot && unpricedDays > 0),
    unpricedDays,
  };
}

export function CostDataQualityBadge({
  snapshot,
  t,
}: {
  snapshot: CodexCostUsageSnapshot | null | undefined;
  t: Translate;
}): JSX.Element | null {
  const { diagnostics, incompleteCoverage, partiallyUnpriced, unpricedDays } =
    dataQuality(snapshot);
  if (!(incompleteCoverage || partiallyUnpriced)) return null;
  const messages = [
    diagnostics?.failedFiles
      ? t(
          "pier.codex.accounts.settings.costFailedFiles",
          "{count} files could not be read"
        ).replace("{count}", String(diagnostics.failedFiles))
      : null,
    diagnostics?.malformedLines
      ? t(
          "pier.codex.accounts.settings.costMalformedLines",
          "{count} malformed log lines were ignored"
        ).replace("{count}", String(diagnostics.malformedLines))
      : null,
    diagnostics?.truncatedFiles
      ? t(
          "pier.codex.accounts.settings.costTruncatedFiles",
          "{count} files exceeded the scan limit"
        ).replace("{count}", String(diagnostics.truncatedFiles))
      : null,
    unpricedDays > 0
      ? t(
          "pier.codex.accounts.settings.costUnpricedDays",
          "{count} days contain models without pricing"
        ).replace("{count}", String(unpricedDays))
      : null,
  ].filter((message) => message !== null);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge role="status" tabIndex={0} variant="outline">
            {incompleteCoverage
              ? t("pier.codex.accounts.settings.partialData", "Partial data")
              : t(
                  "pier.codex.accounts.settings.partiallyUnpriced",
                  "Some cost is unpriced"
                )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-96" data-pier-codex-scope="">
          {messages.join(" · ") ||
            t(
              "pier.codex.accounts.settings.partialDataUnknown",
              "Some local usage could not be included"
            )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface CostChartBucket {
  cost: number;
  date: string;
  estimatedCostMicrousd: number | null;
  tokens: number | null;
}

function CostBarShape({
  height,
  language,
  payload,
  width,
  x,
  y,
}: BarShapeProps & { language: string }): JSX.Element {
  const bucket = payload as CostChartBucket;
  return (
    <Rectangle
      aria-label={`${bucket.date} · ${formatCurrency(bucket.cost, language)} · ${formatCompactNumber(bucket.tokens ?? 0, language)} tokens`}
      data-cost-bar=""
      fill={
        bucket.estimatedCostMicrousd === null
          ? "var(--muted)"
          : "var(--color-cost)"
      }
      fillOpacity={bucket.estimatedCostMicrousd === null ? 0.55 : 0.82}
      height={height}
      radius={[3, 3, 0, 0]}
      tabIndex={0}
      width={width}
      x={x}
      y={y}
    />
  );
}

function CostBarChart({
  buckets,
  className,
  language,
}: {
  buckets: CostChartBucket[];
  className: string;
  language: string;
}): JSX.Element {
  return (
    <ChartContainer
      className={cn("aspect-auto", className)}
      config={COST_CHART_CONFIG}
      initialDimension={{ height: 80, width: 320 }}
    >
      <BarChart accessibilityLayer data={buckets}>
        <XAxis dataKey="date" hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) =>
                formatCurrency(Number(value ?? 0), language)
              }
              hideIndicator
              labelFormatter={(label) => String(label)}
            />
          }
          cursor={false}
        />
        <Bar
          dataKey="cost"
          fill="var(--color-cost)"
          minPointSize={3}
          radius={[3, 3, 0, 0]}
          shape={(props: BarShapeProps) => (
            <CostBarShape {...props} language={language} />
          )}
        />
      </BarChart>
    </ChartContainer>
  );
}

export function CostUsageVisualization({
  language,
  presentation = "responsive",
  snapshot,
  t,
}: {
  language: string;
  presentation?: "responsive" | "settings";
  snapshot: CodexCostUsageSnapshot | null | undefined;
  t: Translate;
}): JSX.Element {
  const periodDays = formatCount(COST_USAGE_PERIOD_DAYS, language);
  const bucketsByDate = new Map(
    (snapshot?.buckets ?? []).map((bucket) => [bucket.date, bucket])
  );
  const endDate = snapshot?.coverage.to
    ? new Date(`${snapshot.coverage.to}T00:00:00Z`)
    : new Date();
  const chartData: CostChartBucket[] = COST_DAYS.map((_, index) => {
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - (COST_DAYS.length - index - 1));
    const key = date.toISOString().slice(0, 10);
    const bucket = bucketsByDate.get(key);
    const estimatedCostMicrousd = bucket?.estimatedCostMicrousd ?? null;
    return {
      cost: (estimatedCostMicrousd ?? 0) / 1_000_000,
      date: key,
      estimatedCostMicrousd,
      tokens: bucket?.tokens.totalTokens ?? null,
    };
  });
  const latestDate = snapshot?.buckets.at(-1)?.date;
  const metrics = [
    {
      id: "today",
      label: t("pier.codex.accounts.settings.costToday", "Today"),
      value:
        snapshot?.summary.todayEstimatedCostMicrousd == null
          ? "—"
          : formatCurrency(
              snapshot.summary.todayEstimatedCostMicrousd / 1_000_000,
              language
            ),
    },
    {
      id: "period-cost",
      label: t(
        "pier.codex.accounts.settings.costPeriod",
        "Last {count} days cost"
      ).replace("{count}", periodDays),
      value:
        snapshot?.summary.estimatedCostMicrousd == null
          ? "—"
          : formatCurrency(
              snapshot.summary.estimatedCostMicrousd / 1_000_000,
              language
            ),
    },
    {
      id: "period-tokens",
      label: t(
        "pier.codex.accounts.settings.tokensPeriod",
        "Last {count} days tokens"
      ).replace("{count}", periodDays),
      value: snapshot
        ? formatCompactNumber(snapshot.summary.periodTokens, language)
        : "—",
    },
    {
      id: "latest-tokens",
      label: `${t(
        "pier.codex.accounts.settings.tokensLatest",
        "Latest active day tokens"
      )}${latestDate ? ` · ${latestDate}` : ""}`,
      value: snapshot
        ? formatCompactNumber(snapshot.summary.latestDayTokens, language)
        : "—",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          presentation === "settings"
            ? "grid-cols-4 gap-6 max-[36rem]:grid-cols-1 max-[48rem]:grid-cols-2 max-[48rem]:gap-3.5"
            : "@[22rem]:grid-cols-3 @[34rem]:grid-cols-4"
        )}
      >
        {metrics.map((metric) => (
          <div
            className={cn(
              presentation === "responsive" &&
                metric.id !== "today" &&
                "@[22rem]:block hidden",
              presentation === "responsive" &&
                metric.id === "latest-tokens" &&
                "@[34rem]:block @[22rem]:hidden"
            )}
            data-cost-metric={metric.id}
            key={metric.id}
          >
            <span className="block truncate text-muted-foreground text-xs">
              {metric.label}
            </span>
            <strong className="mt-1 block font-semibold text-lg tabular-nums tracking-tight">
              {metric.value}
            </strong>
          </div>
        ))}
      </div>
      <figure
        aria-label={t(
          "pier.codex.accounts.settings.costChart",
          "Daily estimated cost for the last {count} days"
        ).replace("{count}", periodDays)}
        className={cn(
          "mt-3",
          presentation === "settings" ? "h-15" : "min-h-20 flex-1"
        )}
      >
        {presentation === "settings" ? (
          <CostBarChart
            buckets={chartData}
            className="h-full w-full"
            language={language}
          />
        ) : (
          <>
            <CostBarChart
              buckets={chartData.slice(-7)}
              className="@[22rem]:hidden h-full min-h-20 w-full"
              language={language}
            />
            <CostBarChart
              buckets={chartData}
              className="@[22rem]:flex hidden h-full min-h-20 w-full"
              language={language}
            />
          </>
        )}
      </figure>
    </div>
  );
}
