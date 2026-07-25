import { Badge } from "@pier/ui/badge.tsx";
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
  listSupportedUsageSourceLabels,
  resolveUsageSourceLabel,
} from "@/lib/workbench/usage-source-labels.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";
import { CostOverviewChart } from "./cost-overview-chart.tsx";
import {
  type CostOverviewKpiId,
  parseCostOverviewParams,
} from "./cost-overview-params.ts";
import {
  type CostViewKpis,
  type CostViewModel,
  costViewQuery,
} from "./cost-view-query.ts";

/**
 * 布局密度：按物料格子尺寸渐进披露（Apple 小组件思路）。
 * - compact（h≤2 或 w≤2）：主数字 + 可选辅数字，无图无滚动
 * - medium（h=3）：少量 KPI + 图
 * - full（h≥4）：完整 KPI + 图 + 说明/脚注
 */
type CostDensity = "compact" | "medium" | "full";

function densityFor(size: { h: number; w: number }): CostDensity {
  if (size.h <= 2 || size.w <= 2) return "compact";
  if (size.h <= 3) return "medium";
  return "full";
}

function maxKpisFor(density: CostDensity, width: number): number {
  if (density === "compact") return width <= 2 ? 1 : 2;
  if (density === "medium") return width >= 6 ? 4 : 2;
  return 4;
}

function rankingLimitFor(density: CostDensity, height: number): number {
  if (density === "compact") return 0;
  if (density === "medium") return height <= 3 ? 4 : 6;
  return height >= 5 ? 10 : 6;
}

/**
 * KPI 单元格。极简样式（无边框、无背景）——参考仪表盘 dense KPI 惯例，让
 * label / value 视觉重量差通过字号 + 前景色对比表达，不靠容器装饰。
 */
function KpiTile({
  label,
  value,
  compact,
}: {
  compact?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        className={
          compact
            ? "truncate text-[11px] text-muted-foreground leading-none"
            : "truncate text-muted-foreground text-xs"
        }
      >
        {label}
      </span>
      <p
        className={
          compact
            ? "truncate font-semibold text-base tabular-nums leading-tight"
            : "font-semibold text-lg tabular-nums leading-tight"
        }
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
  const visibleKpis = parsed.kpis.slice(0, maxKpisFor(density, size.w));
  const showChart = density !== "compact";
  const showDescription = density === "full";
  const showFooter = density !== "compact";
  const rankingLimit = rankingLimitFor(density, size.h);

  return (
    <div
      className={
        density === "compact"
          ? "flex h-full min-h-0 flex-col justify-center gap-2 overflow-hidden p-3"
          : "flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3"
      }
      data-density={density}
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
        className={
          density === "compact"
            ? "grid shrink-0 grid-cols-1 gap-2"
            : "grid shrink-0 @[24rem]:grid-cols-2 @[36rem]:grid-cols-4 grid-cols-1 gap-x-6 gap-y-3"
        }
        data-testid="cost-overview-kpis"
      >
        {visibleKpis.map((id) => (
          <KpiTile
            compact={density === "compact"}
            key={id}
            label={kpiLabel(id, view, t)}
            value={kpiValue(id, view.kpis, locale)}
          />
        ))}
      </div>

      {showChart ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <CostOverviewChart
            locale={locale}
            rankingLimit={rankingLimit}
            view={view}
          />
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
 * `usageData.refreshAll()` 完成。
 */
export function costOverviewWidgetActions(
  _context: WorkbenchWidgetActionContext
): readonly RendererWorkbenchWidgetAction[] {
  return [
    {
      icon: RefreshCw,
      id: "refresh",
      async invoke() {
        await window.pier.usageData.refreshAll();
        toast.success(
          i18next.t("workbench.widget.costOverview.refreshSuccess")
        );
      },
      label: () => i18next.t("workbench.widget.refresh"),
      priority: 50,
    },
  ];
}
