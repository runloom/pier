import { Badge } from "@pier/ui/badge.tsx";
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  WidgetEmpty,
  WidgetError,
  WidgetSkeleton,
} from "@pier/ui/widget-state.tsx";
import type {
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
  WorkbenchWidgetComponentProps,
} from "@plugins/api/renderer.ts";
import i18next, { type TFunction } from "i18next";
import { DollarSign, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  type WorkbenchWidgetDensity,
  workbenchDensityFor,
  workbenchKpiCollectionClassName,
  workbenchKpiCollectionStyle,
  workbenchKpiLayoutMode,
  workbenchMaxKpisFor,
} from "@/lib/workbench/kpi-auto-layout.ts";
import {
  listSupportedUsageSourceLabels,
  resolveUsageSourceLabel,
} from "@/lib/workbench/usage-source-labels.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";
import {
  CostOverviewChart,
  costOverviewChartHasContent,
} from "./cost-overview-chart.tsx";
import {
  type CostOverviewKpiId,
  DEFAULT_COST_OVERVIEW_KPIS,
  parseCostOverviewParams,
} from "./cost-overview-params.ts";
import {
  type CostViewKpis,
  type CostViewModel,
  costViewQuery,
} from "./cost-view-query.ts";

type CostDensity = WorkbenchWidgetDensity;

function densityFor(size: { h: number; w: number }): CostDensity {
  return workbenchDensityFor(size);
}

function maxKpisFor(density: CostDensity, width: number): number {
  return workbenchMaxKpisFor(density, width);
}

function rankingLimitFor(density: CostDensity, height: number): number {
  if (density === "compact") return 0;
  if (density === "medium") return height <= 3 ? 4 : 6;
  return height >= 5 ? 10 : 6;
}

/** 用默认池把 KPI 列表补到 max。 */
function resolveVisibleKpis(
  selected: readonly CostOverviewKpiId[],
  max: number
): CostOverviewKpiId[] {
  const filled: CostOverviewKpiId[] = [];
  for (const id of selected) {
    if (filled.length >= max) break;
    if (!filled.includes(id)) filled.push(id);
  }
  for (const id of DEFAULT_COST_OVERVIEW_KPIS) {
    if (filled.length >= max) break;
    if (!filled.includes(id)) filled.push(id);
  }
  return filled;
}

/**
 * KPI 单元格。
 * - primary：主指标，数字更大
 * - secondary：次指标，略小，仍完整可读（纵排时不截断到 $14,…）
 */
function KpiTile({
  label,
  value,
  role = "secondary",
}: {
  label: string;
  role?: "primary" | "secondary";
  value: string;
}) {
  const primary = role === "primary";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className={cn(
          "truncate text-muted-foreground leading-none",
          primary ? "text-xs" : "text-[11px]"
        )}
      >
        {label}
      </span>
      <p
        className={cn(
          "min-w-0 font-semibold tabular-nums leading-none tracking-tight",
          // 纵排：允许稍长数字完整显示；横排才 truncate
          primary ? "text-2xl" : "text-lg",
          "break-all"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function formatCostValue(value: number | null, locale: string): string {
  // null = 未定价窗口；禁止格式成 $0.00
  return value === null ? "—" : formatCurrency(value, locale);
}

function kpiLabel(
  id: CostOverviewKpiId,
  view: CostViewModel,
  t: TFunction
): string {
  switch (id) {
    case "today":
      return t("workbench.widget.costOverview.today");
    case "period":
      return t("workbench.widget.costOverview.periodDynamic", {
        count: view.rangeDays,
      });
    case "periodTokens":
      return t("workbench.widget.costOverview.periodTokensDynamic", {
        count: view.rangeDays,
      });
    case "latestDayTokens":
      return view.kpis.latestDataDate
        ? t("workbench.widget.costOverview.latestDayTokens", {
            date: view.kpis.latestDataDate,
          })
        : t("workbench.widget.costOverview.latestDayTokensNoDate");
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function kpiValue(
  id: CostOverviewKpiId,
  kpis: CostViewKpis,
  locale: string
): string {
  switch (id) {
    case "today":
      return formatCostValue(kpis.today, locale);
    case "period":
      return formatCostValue(kpis.period, locale);
    case "periodTokens":
      return formatCompactNumber(kpis.periodTokens, locale);
    case "latestDayTokens":
      return formatCompactNumber(kpis.latestDayTokens, locale);
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function EmptyByReason({
  reason,
  t,
}: {
  reason: NonNullable<CostViewModel["emptyReason"]>;
  t: TFunction;
}) {
  if (reason === "filtered-empty") {
    return (
      <WidgetEmpty
        hint={t("workbench.widget.costOverview.emptyFilteredHint")}
        icon={DollarSign}
        title={t("workbench.widget.costOverview.emptyFiltered")}
      />
    );
  }
  if (reason === "no-points-in-range") {
    return (
      <WidgetEmpty
        hint={t("workbench.widget.costOverview.emptyInRangeHint")}
        icon={DollarSign}
        title={t("workbench.widget.costOverview.emptyInRange")}
      />
    );
  }
  return (
    <WidgetEmpty
      hint={t("workbench.widget.costOverview.noDataHint", {
        sources: listSupportedUsageSourceLabels(t),
      })}
      icon={DollarSign}
      title={t("workbench.widget.costOverview.noData")}
    />
  );
}

/** Keep KPI/chart shell when range is empty but tokens/unpriced still signal activity. */
function shouldShowContentShell(view: CostViewModel): boolean {
  if (view.emptyReason === null) return true;
  if (
    view.emptyReason === "no-sources" ||
    view.emptyReason === "filtered-empty"
  ) {
    return false;
  }
  // no-points-in-range: keep shell if any KPI/token/unpriced signal
  const k = view.kpis;
  return (
    k.today != null ||
    k.period != null ||
    k.periodTokens > 0 ||
    k.latestDayTokens > 0 ||
    view.unpricedDayCount > 0 ||
    view.series.length > 0 ||
    view.ranking.length > 0
  );
}

/**
 * 跨插件成本聚合物料。params → parseCostOverviewParams → costViewQuery。
 *
 * 视图切换（总览/来源/模型/tokens）只在设置里改；卡片面按尺寸自适应披露。
 * refreshable=false，改用 `costOverviewWidgetActions` 提供自定义刷新 action。
 * 数据来自 app-shell 级 push store；始终订阅，避免切回 tab 时闪 skeleton。
 */
export function CostOverviewWidget({
  params,
  size,
}: WorkbenchWidgetComponentProps) {
  const t = useT();
  const locale = i18next.language || "en";
  const density = densityFor(size);

  const snapshot = useUsageDataStore((state) => state.snapshot);
  const loadStatus = useUsageDataStore((state) => state.loadStatus);
  const loadError = useUsageDataStore((state) => state.error);

  const parsed = useMemo(
    () => parseCostOverviewParams(params as Readonly<Record<string, unknown>>),
    [params]
  );

  const view = useMemo(
    () =>
      costViewQuery({
        params: parsed,
        resolveSourceLabel: (pluginId, sourceId) =>
          resolveUsageSourceLabel(t, pluginId, sourceId),
        snapshot,
      }),
    [snapshot, parsed, t]
  );

  if (loadStatus === "idle") {
    return <WidgetSkeleton />;
  }
  if (loadStatus === "error") {
    return (
      <WidgetError
        message={t("workbench.widget.costOverview.loadFailed", {
          error: loadError ?? t("workbench.widget.costOverview.unknownError"),
        })}
      />
    );
  }
  if (!shouldShowContentShell(view) && view.emptyReason !== null) {
    return <EmptyByReason reason={view.emptyReason} t={t} />;
  }

  const observedAt =
    view.observedAt > 0
      ? formatRelativeTime(view.observedAt, Date.now(), locale)
      : "";
  const showUnpriced = view.measure !== "tokens" && view.unpricedDayCount > 0;
  const maxKpis = maxKpisFor(density, size.w);
  const visibleKpis = resolveVisibleKpis(parsed.kpis, maxKpis);
  const rankingLimit = rankingLimitFor(density, size.h);
  // 有序列数据就出图；绝不挂空 flex-1 壳
  const showChartSlot =
    density !== "compact" && costOverviewChartHasContent(view, rankingLimit);
  const showDescription = density === "full";
  const showFooter = density !== "compact";
  // KPI 排列：内容 auto-fit 网格（宽→横排铺满，窄→自然换行），禁止 stack/row 单轴
  const kpiLayout = workbenchKpiLayoutMode(visibleKpis.length);
  const kpiGridClassName = workbenchKpiCollectionClassName(visibleKpis.length);
  const kpiGridStyle = workbenchKpiCollectionStyle(visibleKpis.length);

  return (
    <div
      className={
        density === "compact"
          ? "flex h-full min-h-0 flex-col justify-start gap-2 overflow-hidden p-2.5"
          : "flex h-full min-h-0 flex-col justify-start gap-3 overflow-hidden p-3"
      }
      data-density={density}
      data-kpi-layout={kpiLayout}
      data-size-h={size.h}
      data-size-w={size.w}
      data-testid="cost-overview-content"
    >
      {showDescription ? (
        <div className="flex shrink-0 flex-col gap-0.5">
          <p
            className="text-muted-foreground text-xs leading-relaxed"
            data-testid="cost-overview-description"
          >
            {t("workbench.widget.costOverview.description")}
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {t("workbench.widget.costOverview.rangeLabel", {
              count: view.rangeDays,
            })}
          </p>
        </div>
      ) : null}

      <div
        className={kpiGridClassName}
        data-layout={kpiLayout}
        data-testid="cost-overview-kpis"
        style={kpiGridStyle}
      >
        {visibleKpis.map((id, index) => (
          <KpiTile
            key={id}
            label={kpiLabel(id, view, t)}
            role={index === 0 ? "primary" : "secondary"}
            value={kpiValue(id, view.kpis, locale)}
          />
        ))}
      </div>

      {showChartSlot ? (
        <div
          className="relative min-h-24 w-full min-w-0 flex-1"
          data-testid="cost-overview-chart-slot"
        >
          {/* absolute 填充：recharts 在纯 flex-1 链上经常高度为 0 */}
          <div className="absolute inset-0 min-h-0">
            <CostOverviewChart
              locale={locale}
              rankingLimit={rankingLimit}
              view={view}
            />
          </div>
        </div>
      ) : null}

      {showFooter ? (
        <div className="flex shrink-0 items-center justify-between gap-2 text-muted-foreground text-xs">
          <span className="truncate" data-testid="cost-overview-observed-at">
            {observedAt
              ? t("workbench.widget.costOverview.updatedAt", {
                  relative: observedAt,
                })
              : ""}
          </span>
          {showUnpriced ? (
            <Badge
              className="shrink-0"
              data-testid="cost-overview-unpriced"
              title={t("workbench.widget.costOverview.unpricedNoteHover")}
              variant="outline"
            >
              {t("workbench.widget.costOverview.unpricedNote", {
                count: view.unpricedDayCount,
              })}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 自定义刷新 action：`invoke` 返回 Promise，header 按钮的 spinner 会持续到
 * `usageData.refreshAll()` 完成。Bulk refresh skips the success toast so the
 * host can show a single summary.
 */
export function costOverviewWidgetActions(
  _context: WorkbenchWidgetActionContext
): readonly RendererWorkbenchWidgetAction[] {
  return [
    {
      icon: RefreshCw,
      id: "refresh",
      async invoke(actionContext: WorkbenchWidgetActionContext) {
        await window.pier.usageData.refreshAll();
        if (!actionContext.bulkRefresh) {
          toast.success(
            i18next.t("workbench.widget.costOverview.refreshSuccess")
          );
        }
      },
      label: () => i18next.t("workbench.widget.refresh"),
      priority: 50,
    },
  ];
}
