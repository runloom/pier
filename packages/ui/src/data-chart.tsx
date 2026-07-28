"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltipContent,
} from "./chart.tsx";
import { cn } from "./utils.ts";

export type DataChartDatum = Record<string, number | string | null | undefined>;

export interface DataChartSeries {
  key: string;
  label: string;
  tone?: 1 | 2 | 3 | 4 | 5;
}

export interface DataChartProps {
  "aria-label": string;
  categoryKey: string;
  className?: string;
  data: readonly DataChartDatum[];
  emptyText?: string;
  height?: number;
  onDatumSelect?: (datum: DataChartDatum, index: number) => void;
  series: readonly DataChartSeries[];
  showGrid?: boolean;
  showLegend?: boolean;
  type: "area" | "bar" | "donut" | "line";
  valueFormatter?: (value: number) => string;
}

const DEFAULT_TONES = [1, 2, 3, 4, 5] as const;

function chartColor(series: DataChartSeries, index: number): string {
  const tone = series.tone ?? DEFAULT_TONES[index % DEFAULT_TONES.length];
  return `var(--chart-${tone})`;
}

function datumFromChartState(
  state: unknown
): { datum: DataChartDatum; index: number } | null {
  if (!(state && typeof state === "object" && "activePayload" in state)) {
    return null;
  }
  const payload = state.activePayload;
  if (!(Array.isArray(payload) && payload.length > 0)) {
    return null;
  }
  const first = payload[0];
  if (!(first && typeof first === "object" && "payload" in first)) {
    return null;
  }
  const datum = first.payload;
  if (!(datum && typeof datum === "object")) {
    return null;
  }
  const index =
    "activeTooltipIndex" in state &&
    typeof state.activeTooltipIndex === "number"
      ? state.activeTooltipIndex
      : 0;
  return { datum: datum as DataChartDatum, index };
}

export function DataChart({
  "aria-label": ariaLabel,
  categoryKey,
  className,
  data,
  emptyText = "暂无可绘制的数据。",
  height = 220,
  onDatumSelect,
  series,
  showGrid = true,
  showLegend = true,
  type,
  valueFormatter = (value) => String(value),
}: DataChartProps) {
  const visibleSeries = series.slice(0, DEFAULT_TONES.length);
  const primarySeries = visibleSeries[0];
  const config: ChartConfig = Object.fromEntries(
    visibleSeries.map((item, index) => [
      item.key,
      { color: chartColor(item, index), label: item.label },
    ])
  );

  if (data.length === 0 || !primarySeries) {
    return (
      <div
        aria-label={ariaLabel}
        className={cn(
          "grid min-h-40 place-items-center rounded-lg border border-dashed bg-muted/30 text-muted-foreground text-sm",
          className
        )}
        data-slot="data-chart"
        role="img"
        style={{ height }}
      >
        {emptyText}
      </div>
    );
  }

  const handleChartClick = (state: unknown) => {
    const selected = datumFromChartState(state);
    if (selected) {
      onDatumSelect?.(selected.datum, selected.index);
    }
  };
  const tooltip = (
    <Tooltip
      content={
        <ChartTooltipContent
          formatter={(value, name) => (
            <div className="flex min-w-28 items-center justify-between gap-3">
              <span className="text-muted-foreground">{String(name)}</span>
              <span className="font-mono tabular-nums">
                {valueFormatter(Number(value))}
              </span>
            </div>
          )}
        />
      }
      cursor={{ fill: "var(--muted)", opacity: 0.45 }}
    />
  );

  if (type === "donut") {
    return (
      <ChartContainer
        aria-label={ariaLabel}
        className={cn("aspect-auto w-full", className)}
        config={config}
        data-slot="data-chart"
        initialDimension={{ height, width: 640 }}
        role="img"
        style={{ height }}
      >
        <PieChart accessibilityLayer>
          {tooltip}
          {showLegend ? <Legend verticalAlign="bottom" /> : null}
          <Pie
            data={data.map((datum, index) => ({
              ...datum,
              fill: `var(--chart-${DEFAULT_TONES[index % DEFAULT_TONES.length]})`,
            }))}
            dataKey={primarySeries.key}
            innerRadius="52%"
            isAnimationActive={false}
            nameKey={categoryKey}
            onClick={(_, index) => {
              const datum = data[index];
              if (datum) {
                onDatumSelect?.(datum, index);
              }
            }}
            outerRadius="78%"
            paddingAngle={2}
            stroke="var(--background)"
          />
        </PieChart>
      </ChartContainer>
    );
  }

  const common = {
    accessibilityLayer: true,
    data: data as DataChartDatum[],
    margin: { bottom: showLegend ? 4 : 0, left: 0, right: 8, top: 8 },
    onClick: handleChartClick,
  };
  const axes = (
    <>
      {showGrid ? (
        <CartesianGrid
          stroke="var(--border)"
          strokeDasharray="3 3"
          vertical={false}
        />
      ) : null}
      <XAxis
        axisLine={false}
        dataKey={categoryKey}
        fontSize={11}
        tick={{ fill: "var(--muted-foreground)" }}
        tickLine={false}
      />
      <YAxis
        axisLine={false}
        fontSize={11}
        tick={{ fill: "var(--muted-foreground)" }}
        tickFormatter={(value) => valueFormatter(Number(value))}
        tickLine={false}
        width={42}
      />
      {tooltip}
      {showLegend ? <Legend verticalAlign="top" /> : null}
    </>
  );

  let chartContent: ReactNode;
  if (type === "line") {
    chartContent = (
      <LineChart {...common}>
        {axes}
        {visibleSeries.map((item, index) => (
          <Line
            dataKey={item.key}
            dot={false}
            isAnimationActive={false}
            key={item.key}
            name={item.label}
            stroke={chartColor(item, index)}
            strokeWidth={2}
            type="monotone"
          />
        ))}
      </LineChart>
    );
  } else if (type === "area") {
    chartContent = (
      <AreaChart {...common}>
        {axes}
        {visibleSeries.map((item, index) => (
          <Area
            dataKey={item.key}
            fill={chartColor(item, index)}
            fillOpacity={0.14}
            isAnimationActive={false}
            key={item.key}
            name={item.label}
            stroke={chartColor(item, index)}
            strokeWidth={2}
            type="monotone"
          />
        ))}
      </AreaChart>
    );
  } else {
    chartContent = (
      <BarChart {...common}>
        {axes}
        {visibleSeries.map((item, index) => (
          <Bar
            dataKey={item.key}
            fill={chartColor(item, index)}
            isAnimationActive={false}
            key={item.key}
            name={item.label}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <ChartContainer
      aria-label={ariaLabel}
      className={cn("aspect-auto w-full", className)}
      config={config}
      data-slot="data-chart"
      initialDimension={{ height, width: 640 }}
      role="img"
      style={{ height }}
    >
      {chartContent}
    </ChartContainer>
  );
}
