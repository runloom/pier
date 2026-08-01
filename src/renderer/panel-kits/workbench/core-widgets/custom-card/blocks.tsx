import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@pier/ui/chart.tsx";
import type { WidgetDensity } from "@pier/ui/collection-auto-layout.ts";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import i18next from "i18next";
import { useId } from "react";
import { Area, AreaChart } from "recharts";
import { useT } from "@/i18n/use-t.ts";
import { formatMetricNumber } from "@/lib/workbench/metric-format.ts";
import {
  getMetricRegistration,
  type MetricValue,
  useMetricValue,
} from "@/lib/workbench/metric-registry.ts";
import {
  type CustomCardBlock,
  type CustomCardBlockType,
  rankingLimitForDensity,
} from "./params.ts";

const TREND_CHART_CONFIG = {
  value: { color: "var(--chart-1)", label: "Value" },
} satisfies ChartConfig;

function KpiBlockBody({
  format,
  isPrimary,
  locale,
  value,
}: {
  format: Parameters<typeof formatMetricNumber>[0];
  isPrimary: boolean;
  locale: string;
  value: MetricValue;
}) {
  const raw = value.kind === "instant" ? value.value : null;
  const muted = raw === null;
  return (
    <p
      className={cn(
        "min-w-0 font-semibold tabular-nums leading-none tracking-tight",
        isPrimary ? "text-2xl" : "text-lg",
        muted ? "text-muted-foreground" : "text-foreground",
        "break-all"
      )}
    >
      {formatMetricNumber(format, raw, locale)}
    </p>
  );
}

const CIRCLE_RADIUS = 28;
const CIRCLE_STROKE = 6;
const CIRCLE_SIZE = (CIRCLE_RADIUS + CIRCLE_STROKE) * 2;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

function GaugeBlockBody({
  locale,
  value,
}: {
  locale: string;
  value: MetricValue;
}) {
  const ratio = value.kind === "instant" ? value.value : null;
  const clamped = Math.max(0, Math.min(1, ratio ?? 0));
  const offset = CIRCLE_CIRCUMFERENCE * (1 - clamped);
  const pctText = formatMetricNumber("percent", ratio, locale);
  return (
    <div className="flex items-center gap-2">
      <meter
        aria-label={pctText}
        className="sr-only"
        max={1}
        min={0}
        value={ratio === null ? undefined : ratio}
      />
      <svg
        aria-hidden="true"
        className="shrink-0 -rotate-90"
        height={CIRCLE_SIZE}
        viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
        width={CIRCLE_SIZE}
      >
        <circle
          className="fill-none stroke-muted/40"
          cx={CIRCLE_SIZE / 2}
          cy={CIRCLE_SIZE / 2}
          r={CIRCLE_RADIUS}
          strokeWidth={CIRCLE_STROKE}
        />
        <circle
          className="fill-none stroke-primary transition-[stroke-dashoffset] duration-300"
          cx={CIRCLE_SIZE / 2}
          cy={CIRCLE_SIZE / 2}
          r={CIRCLE_RADIUS}
          strokeDasharray={CIRCLE_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth={CIRCLE_STROKE}
        />
      </svg>
      <span className="shrink-0 font-semibold text-foreground text-sm tabular-nums">
        {pctText}
      </span>
    </div>
  );
}

function TrendBlockBody({
  format,
  locale,
  value,
}: {
  format: Parameters<typeof formatMetricNumber>[0];
  locale: string;
  value: MetricValue;
}) {
  const t = useT();
  const gradientId = `custom-card-trend-fill-${useId().replaceAll(":", "")}`;
  const points = value.kind === "series" ? value.points : [];
  if (points.length < 2) {
    return (
      <div className="flex h-14 items-center justify-center rounded-md bg-muted/30">
        <span className="text-muted-foreground text-xs">
          {t("workbench.widget.customCard.insufficientData")}
        </span>
      </div>
    );
  }
  const last = points.at(-1);
  const lastValueText = formatMetricNumber(format, last?.value ?? null, locale);
  return (
    <div className="relative h-16 w-full">
      <ChartContainer
        className="aspect-auto h-16 w-full"
        config={TREND_CHART_CONFIG}
      >
        <AreaChart
          data={points as { ts: number; value: number }[]}
          margin={{ bottom: 2, left: 0, right: 4, top: 2 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop
                className="text-primary"
                offset="0%"
                stopColor="currentColor"
                stopOpacity={0.25}
              />
              <stop
                className="text-primary"
                offset="100%"
                stopColor="currentColor"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <Area
            dataKey="value"
            dot={false}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            stroke="var(--color-value)"
            strokeWidth={1.5}
            type="monotone"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(entry) => {
                  const raw = typeof entry === "number" ? entry : null;
                  return (
                    <span className="font-mono tabular-nums">
                      {formatMetricNumber(format, raw, locale)}
                    </span>
                  );
                }}
                hideLabel
                nameKey="value"
              />
            }
            cursor={false}
          />
        </AreaChart>
      </ChartContainer>
      <span
        className="pointer-events-none absolute top-0 right-0 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
        data-testid="custom-card-trend-last"
      >
        {lastValueText}
      </span>
    </div>
  );
}

function RankingBlockBody({
  density,
  format,
  height,
  locale,
  value,
}: {
  density: WidgetDensity;
  format: Parameters<typeof formatMetricNumber>[0];
  height: number;
  locale: string;
  value: MetricValue;
}) {
  const items = value.kind === "grouped" ? value.items : [];
  if (items.length === 0) {
    return <p className="text-muted-foreground text-xs">—</p>;
  }
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const limit = rankingLimitForDensity(density, height);
  const top = sorted.slice(0, limit);
  const max = Math.max(...sorted.map((item) => item.value), 1);
  return (
    <ol
      className="flex flex-col gap-1.5"
      data-testid="custom-card-ranking-list"
    >
      {top.map((item) => {
        const widthPct = `${(item.value / max) * 100}%`;
        return (
          <li
            aria-label={`${item.label}: ${formatMetricNumber(format, item.value, locale)}`}
            className="flex flex-col gap-0.5"
            key={item.label}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {formatMetricNumber(format, item.value, locale)}
              </span>
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-muted/60"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: widthPct }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function renderBlockBody(
  type: CustomCardBlockType,
  value: MetricValue | null,
  format: Parameters<typeof formatMetricNumber>[0],
  locale: string,
  density: WidgetDensity,
  height: number,
  isPrimary: boolean
): React.ReactNode {
  if (value === null) {
    if (type === "trend") {
      return <Skeleton className="h-16 w-full rounded-md" />;
    }
    if (type === "ranking") {
      return (
        <div className="flex flex-col gap-1.5">
          {Array.from({
            length: Math.min(3, rankingLimitForDensity(density, height) || 3),
          }).map((_, i) => (
            <Skeleton className="h-3 w-full rounded-full" key={String(i)} />
          ))}
        </div>
      );
    }
    if (type === "gauge") {
      return <Skeleton className="h-14 w-14 rounded-full" />;
    }
    return (
      <Skeleton
        className={cn("w-full rounded-full", isPrimary ? "h-7" : "h-5")}
      />
    );
  }
  switch (type) {
    case "gauge":
      return <GaugeBlockBody locale={locale} value={value} />;
    case "kpi":
      return (
        <KpiBlockBody
          format={format}
          isPrimary={isPrimary}
          locale={locale}
          value={value}
        />
      );
    case "ranking":
      return (
        <RankingBlockBody
          density={density}
          format={format}
          height={height}
          locale={locale}
          value={value}
        />
      );
    case "trend":
      return <TrendBlockBody format={format} locale={locale} value={value} />;
    default:
      return null;
  }
}

/** 单区块渲染：指标未注册 → 不可用占位；否则按块型出图。 */
export function CustomCardBlockView({
  block,
  density,
  height,
  isPrimary = false,
  visible,
}: {
  block: CustomCardBlock;
  density: WidgetDensity;
  height: number;
  isPrimary?: boolean;
  visible: boolean;
}) {
  const t = useT();
  const locale = i18next.language || "en";
  const registration = getMetricRegistration(block.metricId);
  const value = useMetricValue(block.metricId, visible);
  const label =
    block.label ??
    (registration ? t(registration.descriptor.titleKey) : block.metricId);

  if (!registration) {
    return (
      <div className="rounded-lg border border-border/60 border-dashed px-3 py-2">
        <p className="truncate text-muted-foreground text-xs">{label}</p>
        <p className="text-muted-foreground text-xs">
          {t("workbench.widget.customCard.metricUnavailable")}
        </p>
        <p className="text-muted-foreground/80 text-xs">
          {t("workbench.widget.customCard.metricUnavailableHint")}
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label={label}
      className={cn(
        "min-w-0 rounded-lg border border-border/60 bg-muted/30 px-3 py-2",
        "flex flex-col gap-1"
      )}
      data-testid={`custom-card-block-${block.type}`}
    >
      <p className="truncate text-muted-foreground text-xs">{label}</p>
      {renderBlockBody(
        block.type,
        value,
        registration.descriptor.format,
        locale,
        density,
        height,
        isPrimary
      )}
    </section>
  );
}
