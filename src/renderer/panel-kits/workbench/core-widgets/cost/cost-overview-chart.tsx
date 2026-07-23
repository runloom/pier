import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@pier/ui/chart.tsx";
import { ChartTooltipPortalContent } from "@pier/ui/chart-tooltip-portal.tsx";
import { formatCompactNumber, formatCurrency } from "@pier/ui/format.tsx";
import { useMemo, useRef } from "react";
import {
  Bar,
  BarChart,
  BarStack,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import type { CostViewModel } from "./cost-view-query.ts";

function buildChartConfig(view: CostViewModel): ChartConfig {
  if (view.chart === "line") {
    return {
      value: {
        color: "var(--chart-1)",
        label: view.measure === "tokens" ? "tokens" : "cost",
      },
    };
  }
  const config: ChartConfig = {};
  for (const meta of view.sourceMetas) {
    config[meta.dataKey] = { color: meta.color, label: meta.label };
  }
  return config;
}

function formatRankingValue(
  value: number,
  measure: CostViewModel["measure"],
  locale: string
): string {
  return measure === "tokens"
    ? formatCompactNumber(value, locale)
    : formatCurrency(value, locale);
}

/**
 * 成本总览图表区：stackedBar / line / ranking。
 * 抽离以控制 widget 主文件行数；坐标轴 hide，靠 tooltip 读数。
 */
export function CostOverviewChart({
  locale,
  view,
}: {
  locale: string;
  view: CostViewModel;
}) {
  const chartAnchorRef = useRef<HTMLDivElement>(null);
  const config = useMemo(() => buildChartConfig(view), [view]);

  if (view.chart === "ranking") {
    if (view.ranking.length === 0) return null;
    const max = Math.max(...view.ranking.map((row) => row.value), 1);
    return (
      <div
        className="flex min-h-8 flex-1 flex-col gap-1.5"
        data-testid="cost-overview-chart"
      >
        {view.ranking.map((row) => (
          <div className="flex flex-col gap-0.5" key={row.label}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {formatRankingValue(row.value, view.measure, locale)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (view.series.length === 0) return null;

  if (view.chart === "line") {
    return (
      <div
        className="flex min-h-8 flex-1 flex-col"
        data-testid="cost-overview-chart"
        ref={chartAnchorRef}
      >
        <ChartContainer
          className="aspect-auto min-h-8 w-full flex-1"
          config={config}
        >
          <LineChart
            data={view.series as { date: string; value?: number }[]}
            margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
          >
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <ChartTooltip
              content={<ChartTooltipPortalContent anchorRef={chartAnchorRef} />}
            />
            <Line
              data-testid="cost-overview-chart-line"
              dataKey="value"
              dot={false}
              isAnimationActive={false}
              stroke="var(--color-value)"
              strokeWidth={1.5}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
        {/* recharts Line 不转发 DOM test id；用稳定锚点供组件测锁定 line 模式 */}
        <span className="sr-only" data-testid="cost-overview-chart-line" />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-8 flex-1 flex-col"
      data-testid="cost-overview-chart"
      ref={chartAnchorRef}
    >
      <ChartContainer
        className="aspect-auto min-h-8 w-full flex-1"
        config={config}
      >
        <BarChart
          data={view.series}
          margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
        >
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <ChartTooltip
            content={<ChartTooltipPortalContent anchorRef={chartAnchorRef} />}
          />
          <BarStack radius={[2, 2, 0, 0]} stackId="cost">
            {view.sourceMetas.map((meta) => (
              <Bar
                dataKey={meta.dataKey}
                fill={`var(--color-${meta.dataKey})`}
                isAnimationActive={false}
                key={meta.dataKey}
                name={meta.label}
              />
            ))}
          </BarStack>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
