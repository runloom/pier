import { cn } from "@pier/ui/utils.ts";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { PanelsTopLeft } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

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
            className={cn("size-2 shrink-0 rounded-full", dotClass)}
          />
        ) : null}
        <span className="truncate text-muted-foreground text-xs">{label}</span>
      </div>
      <p
        className={cn(
          "@[14rem]:mt-1 font-semibold @[14rem]:text-2xl text-lg leading-tight",
          value === 0 ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function activityStatusDot(activity: ForegroundActivity): string {
  if (activity.kind === "agent") {
    if (activity.status === "processing" || activity.status === "tool") {
      return "bg-success";
    }
    if (activity.status === "waiting") {
      return "bg-warning";
    }
    if (activity.status === "error") {
      return "bg-destructive";
    }
    return "bg-muted-foreground/40";
  }
  if (activity.kind === "task") {
    if (activity.status === "running") {
      return "bg-success";
    }
    if (activity.status === "failure") {
      return "bg-destructive";
    }
    return "bg-muted-foreground/40";
  }
  return "bg-muted-foreground/40";
}

function activityLabel(
  activity: ForegroundActivity,
  t: (key: string) => string
): string {
  if (activity.kind === "agent") {
    return activity.agentId;
  }
  if (activity.kind === "task") {
    return activity.label;
  }
  if (activity.kind === "shell") {
    return (
      activity.commandLine ?? t("workbench.widget.activityOverview.kind.shell")
    );
  }
  return t("workbench.widget.activityOverview.kind.idle");
}

export function ActivityWidget(_props: WorkbenchWidgetComponentProps) {
  const t = useT();
  const activities = useForegroundActivityStore((s) => s.activities);
  const workspaceApi = useWorkspaceStore((s) => s.api);
  const { running, waiting } = activityCounts(activities);
  const total = Object.keys(activities).length;

  // 非 idle 活动按最近更新排序 —— 每行都是 drill-down 入口（点击聚焦对应面板）
  const rows = Object.values(activities)
    .filter((a) => a.kind !== "idle")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const handleReveal = (panelId: string): void => {
    if (!workspaceApi) {
      return;
    }
    // 点击后的反馈是面板切换本身（强自然 UI 反馈）；找不到面板时静默无害。
    activateWorkspacePanel(workspaceApi, panelId, { reveal: "always" });
  };

  return (
    <div className="flex min-h-full flex-col gap-3 p-3">
      {/* KPI 统计行：窄卡纵排、≥14rem 三列（container query） */}
      <div
        className="grid @[14rem]:grid-cols-3 grid-cols-1 gap-2"
        data-testid="activity-stat-grid"
      >
        <StatTile
          label={t("workbench.widget.activityOverview.total")}
          value={total}
        />
        <StatTile
          dotClass="bg-success"
          label={t("workbench.widget.activityOverview.running")}
          value={running}
        />
        <StatTile
          dotClass="bg-warning"
          label={t("workbench.widget.activityOverview.waiting")}
          value={waiting}
        />
      </div>

      {/* 活动列表 / 空态（空态占满剩余高度，垂直水平居中） */}
      {rows.length > 0 ? (
        <div className="flex flex-col">
          {rows.map((activity, i) => (
            <button
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-accent/50",
                i > 0 && "border-border/50 border-t"
              )}
              key={activity.panelId}
              onClick={() => handleReveal(activity.panelId)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    activityStatusDot(activity)
                  )}
                />
                <span className="truncate font-medium text-sm">
                  {activityLabel(activity, t)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-muted-foreground text-xs">
                {t(`workbench.widget.activityOverview.kind.${activity.kind}`)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <WidgetEmpty
          hint={t("workbench.widget.activityOverview.emptyHint")}
          icon={PanelsTopLeft}
          title={t("workbench.widget.activityOverview.empty")}
        />
      )}
    </div>
  );
}
