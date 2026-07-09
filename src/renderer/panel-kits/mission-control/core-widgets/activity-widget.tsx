import type { MissionControlWidgetComponentProps } from "@plugins/api/renderer.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { PanelsTopLeft } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";

function groupActivities(
  activities: Record<string, ForegroundActivity>
): { count: number; kind: ForegroundActivity["kind"] }[] {
  const counts = new Map<ForegroundActivity["kind"], number>();
  for (const a of Object.values(activities)) {
    counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => ({ count, kind }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * KPI 统计块：状态身份由文字旁的色点承载，label/value 走文本 token
 * （文字不穿数据色）；大数字用比例数字，不设 tabular-nums。
 */
function StatTile({
  dotClass,
  label,
  value,
}: {
  dotClass?: string;
  label: string;
  value: number;
}) {
  // 窄卡（<14rem）横排紧凑行（label 左、数值右），≥14rem 恢复纵向 tile——
  // 三行数字不该为形态没响应而触发卡内滚动。
  return (
    <div className="@[14rem]:block flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 @[14rem]:p-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {dotClass ? (
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${dotClass}`}
          />
        ) : null}
        <span className="truncate text-muted-foreground text-xs">{label}</span>
      </div>
      <p
        className={`@[14rem]:mt-1 font-semibold @[14rem]:text-2xl text-lg leading-tight ${value === 0 ? "text-muted-foreground" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

export function ActivityWidget(_props: MissionControlWidgetComponentProps) {
  const t = useT();
  const activities = useForegroundActivityStore((s) => s.activities);
  const { running, waiting } = activityCounts(activities);
  const groups = groupActivities(activities);
  const total = Object.keys(activities).length;

  return (
    <div className="flex min-h-full flex-col gap-3 p-3">
      {/* KPI 统计行：窄卡纵排、≥14rem 三列（container query） */}
      <div
        className="grid @[14rem]:grid-cols-3 grid-cols-1 gap-2"
        data-testid="activity-stat-grid"
      >
        <StatTile
          label={t("missionControl.widget.activityOverview.total")}
          value={total}
        />
        <StatTile
          dotClass="bg-success"
          label={t("missionControl.widget.activityOverview.running")}
          value={running}
        />
        <StatTile
          dotClass="bg-warning"
          label={t("missionControl.widget.activityOverview.waiting")}
          value={waiting}
        />
      </div>

      {/* 活动列表 / 空态（空态占满剩余高度，垂直水平居中） */}
      {groups.length > 0 ? (
        <div className="flex flex-col">
          {groups.map((g, i) => (
            <div
              className={`flex items-center justify-between py-1.5 ${i > 0 ? "border-border/50 border-t" : ""}`}
              key={g.kind}
            >
              <span className="font-medium text-sm">
                {t(`missionControl.widget.activityOverview.kind.${g.kind}`)}
              </span>
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {g.count}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center @[14rem]:gap-1.5 gap-1 @[14rem]:py-2 py-0 text-center">
          <PanelsTopLeft
            aria-hidden="true"
            className="@[14rem]:size-5 size-4 text-muted-foreground/60"
          />
          <p className="font-medium text-sm">
            {t("missionControl.widget.activityOverview.empty")}
          </p>
          {/* 窄卡空间寸土寸金，副句只在 ≥14rem 显示 */}
          <p className="@[14rem]:block hidden text-muted-foreground text-xs">
            {t("missionControl.widget.activityOverview.emptyHint")}
          </p>
        </div>
      )}
    </div>
  );
}
