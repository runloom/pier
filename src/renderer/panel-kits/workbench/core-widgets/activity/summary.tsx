import { cn } from "@pier/ui/utils.ts";
import type { ActivityOverviewCounts } from "@shared/activity-overview.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  workbenchKpiCollectionClassName,
  workbenchKpiCollectionStyle,
} from "@/lib/workbench/kpi-auto-layout.ts";
import type { ActivityDensity } from "./density.ts";

function countToneClass(
  value: number,
  emphasis?: "destructive" | "default"
): string {
  if (value === 0) {
    return "text-muted-foreground";
  }
  if (emphasis === "destructive") {
    return "text-destructive";
  }
  return "text-foreground";
}

function StatTile({
  compact,
  dotClass,
  emphasis,
  label,
  value,
}: {
  compact?: boolean;
  dotClass?: string;
  emphasis?: "destructive" | "default";
  label: string;
  value: number;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-center rounded-lg border border-border/60 bg-muted/30",
        compact ? "gap-1 px-2.5 py-2" : "@[14rem]:p-3 px-3 py-2"
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {dotClass ? (
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0 rounded-full",
              compact ? "size-1.5" : "size-2",
              dotClass
            )}
          />
        ) : null}
        <span
          className={cn("truncate text-muted-foreground text-xs leading-none")}
        >
          {label}
        </span>
      </div>
      <p
        className={cn(
          "min-w-0 font-semibold tabular-nums leading-none tracking-tight",
          compact ? "text-xl" : "@[14rem]:text-2xl text-lg",
          countToneClass(value, emphasis)
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * KPI 摘要。compact 也走满宽 tile 网格（非漂浮 chips），避免小卡中间挂三粒胶囊。
 */
export function ActivitySummary({
  counts,
  density,
  fill = false,
}: {
  counts: ActivityOverviewCounts;
  density: ActivityDensity;
  /** compact 摘要条铺满卡片内容区高度。 */
  fill?: boolean;
}) {
  const t = useT();
  const needsYouLabel = t("workbench.widget.activityOverview.needsYou");
  const runningLabel = t("workbench.widget.activityOverview.running");
  const inProgressLabel = t("workbench.widget.activityOverview.inProgress");
  const compact = density === "compact";
  const itemCount = 3;

  return (
    <div
      className={cn(
        workbenchKpiCollectionClassName(itemCount),
        "gap-2",
        fill && "min-h-0 flex-1 content-stretch",
        fill && "[&>*]:h-full [&>*]:min-h-0"
      )}
      data-testid="activity-stat-grid"
      style={workbenchKpiCollectionStyle(itemCount)}
    >
      <StatTile
        compact={compact}
        dotClass="bg-warning"
        emphasis={counts.needsYou > 0 ? "destructive" : "default"}
        label={needsYouLabel}
        value={counts.needsYou}
      />
      <StatTile
        compact={compact}
        dotClass="bg-success"
        label={runningLabel}
        value={counts.running}
      />
      <StatTile
        compact={compact}
        label={inProgressLabel}
        value={counts.inProgress}
      />
    </div>
  );
}
