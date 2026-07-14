import { Badge } from "@pier/ui/badge.tsx";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@pier/ui/chart.tsx";
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import {
  WidgetEmpty,
  WidgetError,
  WidgetSkeleton,
} from "@pier/ui/widget-state.tsx";
import type {
  MissionControlWidgetActionContext,
  MissionControlWidgetComponentProps,
  RendererMissionControlWidgetAction,
} from "@plugins/api/renderer.ts";
import type {
  UsageAggregateSnapshot,
  UsageDataDailyBucket,
} from "@shared/contracts/usage-data.ts";
import i18next, { type TFunction } from "i18next";
import { DollarSign, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  listSupportedUsageSourceLabels,
  resolveUsageSourceLabel,
} from "@/lib/mission-control/usage-source-labels.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

const SOURCE_COLOR_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

interface SourceMeta {
  color: string;
  dataKey: string;
  label: string;
}

interface StackedRow {
  date: string;
  /** dynamic per-source keys — recharts consumes them by name. */
  [sourceKey: string]: string | number;
}

/**
 * KPI 单元格。极简样式（无边框、无背景）——参考仪表盘 dense KPI 惯例，让
 * label / value 视觉重量差通过字号 + 前景色对比表达，不靠容器装饰。
 */
function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-muted-foreground text-xs">{label}</span>
      <p className="font-semibold text-lg tabular-nums leading-tight">
        {value}
      </p>
    </div>
  );
}

function costUsd(microusd: number | null): number | null {
  return microusd === null ? null : microusd / 1_000_000;
}

function formatEstimatedCost(microusd: number | null, locale: string): string {
  const value = costUsd(microusd);
  return value === null ? "—" : formatCurrency(value, locale);
}

function buildSourceMetas(
  snapshot: UsageAggregateSnapshot,
  t: TFunction
): readonly SourceMeta[] {
  return snapshot.sources.map((source, index) => ({
    color: SOURCE_COLOR_TOKENS[index % SOURCE_COLOR_TOKENS.length]!,
    dataKey: `source${index}`,
    label: resolveUsageSourceLabel(t, source.pluginId, source.sourceId),
  }));
}

function buildStackedRows(
  snapshot: UsageAggregateSnapshot,
  metas: readonly SourceMeta[]
): StackedRow[] {
  // 每源的 date → USD map；缺席源当日贡献 0（recharts stackId 累加同一 x
  // 坐标下所有系列，null 会破坏 tooltip 累加）。metas 与 snapshot.sources
  // 顺序一致，直接用 index 对齐即可。
  const perSourceDate = snapshot.sources.map((source) => {
    const perDate = new Map<string, number>();
    for (const bucket of source.snapshot.buckets) {
      perDate.set(bucket.date, costUsd(bucket.estimatedCostMicrousd) ?? 0);
    }
    return perDate;
  });
  // 全部源在该日均为 0 的桶不产出行——sparkline 只展示有实际花费的日期，
  // 避免长条空隙 / 无意义 0-height bar 占位。
  const rows: StackedRow[] = [];
  for (const bucket of snapshot.overall.buckets) {
    const row: StackedRow = { date: bucket.date };
    let total = 0;
    metas.forEach((meta, index) => {
      const value = perSourceDate[index]?.get(bucket.date) ?? 0;
      row[meta.dataKey] = value;
      total += value;
    });
    if (total > 0) rows.push(row);
  }
  return rows;
}

function chartConfig(metas: readonly SourceMeta[]): ChartConfig {
  const config: ChartConfig = {};
  for (const meta of metas) {
    config[meta.dataKey] = { color: meta.color, label: meta.label };
  }
  return config;
}

function unpricedDayCount(buckets: readonly UsageDataDailyBucket[]): number {
  let count = 0;
  for (const bucket of buckets) {
    if (bucket.pricingStatus !== "complete") count += 1;
  }
  return count;
}

/**
 * 从桶列表里推出"最近有数据的日期"——用于 latestDayTokens KPI 的日期后缀。
 * 桶列表 aggregator 已按日期升序；从后往前找第一个 totalTokens > 0 的桶。
 */
function findLatestDataDate(
  buckets: readonly UsageDataDailyBucket[]
): string | null {
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    if ((buckets[i]?.tokens.totalTokens ?? 0) > 0) {
      return buckets[i]!.date;
    }
  }
  return null;
}

/**
 * 跨插件成本聚合物料。参考仪表盘密集布局：副标题 + 4-KPI 横排 + 极简
 * sparkline + 底部数据新鲜度提示。
 *
 * 与传统 chart card 的关键差异：
 * - 无坐标轴 / 网格 / legend：具体数字通过 hover tooltip 获取；分布形状
 *   本身承担主要信息传递。
 * - KPI tile 无边框 / 背景，只用字号 + 前景色对比区分 label / value。
 * - 所有 KPI 一行呈现（wrap-friendly），让"今天 / 期内成本 / 期内 token /
 *   最近有数据日 token"这些高频指标同屏可比。
 *
 * refreshable=false，改用 `costOverviewWidgetActions` 提供自定义刷新 action，
 * 让宿主 header 刷新按钮的 spinner 反映真实 refreshAll 时长。
 *
 * visible=false 时不订阅 store（store 是 push 型，但仍避免不必要的重渲染）。
 */
export function CostOverviewWidget({
  size,
  visible,
}: MissionControlWidgetComponentProps) {
  const t = useT();
  const locale = i18next.language || "en";

  // 面板不可见时不订阅 store，恢复可见时重新订阅并立刻取值。
  const snapshot = useUsageDataStore((state) =>
    visible ? state.snapshot : null
  );
  const loadStatus = useUsageDataStore((state) => state.loadStatus);
  const loadError = useUsageDataStore((state) => state.error);

  const metas = useMemo(
    () => (snapshot ? buildSourceMetas(snapshot, t) : []),
    [snapshot, t]
  );
  const rows = useMemo(
    () => (snapshot ? buildStackedRows(snapshot, metas) : []),
    [snapshot, metas]
  );
  const config = useMemo(() => chartConfig(metas), [metas]);
  const latestDataDate = useMemo(
    () => (snapshot ? findLatestDataDate(snapshot.overall.buckets) : null),
    [snapshot]
  );

  if (!visible || loadStatus === "idle") {
    return <WidgetSkeleton />;
  }
  if (loadStatus === "error") {
    return (
      <WidgetError
        message={t("missionControl.widget.costOverview.loadFailed", {
          error:
            loadError ?? t("missionControl.widget.costOverview.unknownError"),
        })}
      />
    );
  }
  if (!snapshot || snapshot.sources.length === 0) {
    return (
      <WidgetEmpty
        hint={t("missionControl.widget.costOverview.noDataHint", {
          sources: listSupportedUsageSourceLabels(t),
        })}
        icon={DollarSign}
        title={t("missionControl.widget.costOverview.noData")}
      />
    );
  }

  const summary = snapshot.overall.summary;
  const unpriced = unpricedDayCount(snapshot.overall.buckets);
  const observedAt =
    snapshot.overall.observedAt > 0
      ? formatRelativeTime(snapshot.overall.observedAt, Date.now(), locale)
      : "";

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
      data-testid="cost-overview-content"
    >
      {size.h > 2 ? (
        <p
          className="text-muted-foreground text-xs leading-relaxed"
          data-testid="cost-overview-description"
        >
          {t("missionControl.widget.costOverview.description")}
        </p>
      ) : null}
      {/* KPI 等宽分布(grid),响应式:窄 1 列 / 中 2 列 / 宽 4 列。
          用 grid 而非 flex-wrap+flex-1 是为了在换行前 wide 状态就精确等分,
          避免"内容多的挤内容少的"视觉偏移。*/}
      <div
        className="grid @[24rem]:grid-cols-2 @[36rem]:grid-cols-4 grid-cols-1 gap-x-6 gap-y-3"
        data-testid="cost-overview-kpis"
      >
        <KpiTile
          label={t("missionControl.widget.costOverview.today")}
          value={formatEstimatedCost(
            summary.todayEstimatedCostMicrousd,
            locale
          )}
        />
        <KpiTile
          label={t("missionControl.widget.costOverview.period")}
          value={formatEstimatedCost(summary.estimatedCostMicrousd, locale)}
        />
        <KpiTile
          label={t("missionControl.widget.costOverview.periodTokens")}
          value={formatCompactNumber(summary.periodTokens, locale)}
        />
        <KpiTile
          label={
            latestDataDate
              ? t("missionControl.widget.costOverview.latestDayTokens", {
                  date: latestDataDate,
                })
              : t("missionControl.widget.costOverview.latestDayTokensNoDate")
          }
          value={formatCompactNumber(summary.latestDayTokens, locale)}
        />
      </div>
      {rows.length > 0 ? (
        <div
          className="flex min-h-8 flex-1 flex-col"
          data-testid="cost-overview-chart"
        >
          <ChartContainer
            className="aspect-auto min-h-8 w-full flex-1"
            config={config}
          >
            <BarChart
              data={rows}
              margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
            >
              {/* 坐标轴 hide 而非移除:recharts 需要 XAxis/YAxis 存在才能
                  正确计算 bar 位置和 tooltip x 命中,只是不渲染 tick label。*/}
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              {metas.map((meta, index) => (
                <Bar
                  dataKey={meta.dataKey}
                  fill={`var(--color-${meta.dataKey})`}
                  isAnimationActive={false}
                  key={meta.dataKey}
                  name={meta.label}
                  // 只有 stack 顶层 bar 加顶部圆角:栈内部圆角会破坏堆叠连续
                  // 感,顶层圆角单独一处让整个 bar 看起来是"一根圆角柱"。
                  // 栈顶 = metas 数组最后一项(recharts 按声明顺序自底向上堆)。
                  radius={index === metas.length - 1 ? [2, 2, 0, 0] : 0}
                  stackId="cost"
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
        <span className="truncate" data-testid="cost-overview-observed-at">
          {observedAt
            ? t("missionControl.widget.costOverview.updatedAt", {
                relative: observedAt,
              })
            : ""}
        </span>
        {unpriced > 0 ? (
          <Badge
            className="shrink-0"
            title={t("missionControl.widget.costOverview.unpricedNoteHover")}
            variant="outline"
          >
            {t("missionControl.widget.costOverview.unpricedNote", {
              count: unpriced,
            })}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 自定义刷新 action：`invoke` 返回 Promise，header 按钮的 spinner 会持续到
 * `usageData.refreshAll()` 完成，避免出现"刷新按钮闪一下就恢复但物料内容仍在
 * 加载"的错乱观感。取代默认 `refreshable: true` 的同步 bump refreshToken 方案。
 */
export function costOverviewWidgetActions(
  _context: MissionControlWidgetActionContext
): readonly RendererMissionControlWidgetAction[] {
  return [
    {
      icon: RefreshCw,
      id: "refresh",
      async invoke() {
        await window.pier.usageData.refreshAll();
        toast.success(
          i18next.t("missionControl.widget.costOverview.refreshSuccess")
        );
      },
      label: () => i18next.t("missionControl.widget.refresh"),
      priority: 50,
    },
  ];
}
