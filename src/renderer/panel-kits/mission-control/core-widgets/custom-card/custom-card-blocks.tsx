import { type ChartConfig, ChartContainer } from "@pier/ui/chart.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { cn } from "@pier/ui/utils.ts";
import i18next from "i18next";
import { Area, AreaChart } from "recharts";
import { useT } from "@/i18n/use-t.ts";
import { formatMetricNumber } from "@/lib/mission-control/metric-format.ts";
import {
  getMetricRegistration,
  type MetricValue,
  useMetricValue,
} from "@/lib/mission-control/metric-registry.ts";
import type { CustomCardBlock } from "./custom-card-params.ts";

const TREND_CHART_CONFIG = {
  value: { color: "var(--chart-1)" },
} satisfies ChartConfig;

function KpiBlockBody({
  format,
  locale,
  value,
}: {
  format: Parameters<typeof formatMetricNumber>[0];
  locale: string;
  value: MetricValue;
}) {
  const raw = value.kind === "instant" ? value.value : null;
  return (
    <p
      className={cn(
        "font-semibold text-2xl tabular-nums leading-tight",
        raw === 0 || raw === null ? "text-muted-foreground" : "text-foreground"
      )}
    >
      {formatMetricNumber(format, raw, locale)}
    </p>
  );
}

function GaugeBlockBody({
  locale,
  value,
}: {
  locale: string;
  value: MetricValue;
}) {
  const ratio = value.kind === "instant" ? value.value : null;
  return (
    <div className="flex items-center gap-2">
      <Progress className="h-1.5 flex-1" value={(ratio ?? 0) * 100} />
      <span className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
        {formatMetricNumber("percent", ratio, locale)}
      </span>
    </div>
  );
}

function TrendBlockBody({ value }: { value: MetricValue }) {
  const points = value.kind === "series" ? value.points : [];
  if (points.length < 2) {
    return <div className="h-14 rounded-md bg-muted/30" />;
  }
  return (
    <ChartContainer
      className="aspect-auto h-14 w-full"
      config={TREND_CHART_CONFIG}
    >
      <AreaChart
        data={points as { ts: number; value: number }[]}
        margin={{ bottom: 2, left: 0, right: 0, top: 2 }}
      >
        <Area
          dataKey="value"
          fill="var(--color-value)"
          fillOpacity={0.15}
          isAnimationActive={false}
          stroke="var(--color-value)"
          strokeWidth={1.5}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}

function RankingBlockBody({
  format,
  locale,
  value,
}: {
  format: Parameters<typeof formatMetricNumber>[0];
  locale: string;
  value: MetricValue;
}) {
  const items = value.kind === "grouped" ? value.items : [];
  if (items.length === 0) {
    return <p className="text-muted-foreground text-xs">—</p>;
  }
  const top = [...items].sort((a, b) => b.value - a.value).slice(0, 5);
  const max = Math.max(...top.map((item) => item.value), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {top.map((item) => (
        <div className="flex flex-col gap-0.5" key={item.label}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
              {formatMetricNumber(format, item.value, locale)}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 自定义卡片的单区块渲染：解析指标 → 按块型出图。
 * 指标不可用（注册方未启用/已卸载）时降级为占位行而非崩溃。
 */
export function CustomCardBlockView({
  block,
  visible,
}: {
  block: CustomCardBlock;
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
          {t("missionControl.widget.customCard.metricUnavailable")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="mb-1 truncate text-muted-foreground text-xs">{label}</p>
      {renderBlockBody(
        block.type,
        value,
        registration.descriptor.format,
        locale
      )}
    </div>
  );
}

function renderBlockBody(
  type: CustomCardBlock["type"],
  value: MetricValue | null,
  format: Parameters<typeof formatMetricNumber>[0],
  locale: string
): React.ReactNode {
  if (value === null) {
    return (
      <p className="font-semibold text-2xl text-muted-foreground leading-tight">
        —
      </p>
    );
  }
  switch (type) {
    case "gauge":
      return <GaugeBlockBody locale={locale} value={value} />;
    case "kpi":
      return <KpiBlockBody format={format} locale={locale} value={value} />;
    case "ranking":
      return <RankingBlockBody format={format} locale={locale} value={value} />;
    case "trend":
      return <TrendBlockBody value={value} />;
    default:
      return null;
  }
}
