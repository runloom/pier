import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import {
  activityOverviewCounts,
  flattenGroupedActivityRows,
  groupActivityOverviewRows,
} from "@shared/activity-overview.ts";
import { disambiguateAgentSessionTitles } from "@shared/agent-session-title/index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { revealPanelIdForTaskActivity } from "@shared/task-activity-sources.ts";
import { PanelsTopLeft } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { currentElectronWindowId } from "@/lib/agent-runtime/current-window-id.ts";
import { openAgentIndexQuickPick } from "@/lib/agent-runtime/open-agent-index-quickpick.tsx";
import { promptRenameAgentSession } from "@/lib/agent-runtime/rename-agent-session.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  type PanelDescriptor,
  usePanelDescriptorStore,
} from "@/stores/panel-descriptor.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { projectPathFromContext } from "@/stores/workspace-panel-helpers.ts";
import {
  activityDensityFor,
  activityRowLimitFor,
  activityShowIndexFooter,
  activityShowList,
  activityShowRowMeta,
} from "./activity-density.ts";
import { ActivityRow, agentActivityRowPrimary } from "./activity-row.tsx";
import { ActivitySummary } from "./activity-summary.tsx";

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-0.5">
      <h3 className="px-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      <div className="flex flex-col divide-y divide-border/50">{children}</div>
    </section>
  );
}

function rowsInLimit(
  rows: ForegroundActivity[],
  allowedPanelIds: ReadonlySet<string>
): ForegroundActivity[] {
  return rows.filter((row) => allowedPanelIds.has(row.panelId));
}

function projectPathForActivity(
  activity: ForegroundActivity,
  descriptors: Record<string, PanelDescriptor>,
  indexProjectByPanel: ReadonlyMap<string, string>
): string | undefined {
  const fromIndex = indexProjectByPanel.get(activity.panelId);
  if (fromIndex) {
    return fromIndex;
  }
  return projectPathFromContext(descriptors[activity.panelId]?.context);
}

export function ActivityWidget({ size }: WorkbenchWidgetComponentProps) {
  const t = useT();
  const activities = useForegroundActivityStore((s) => s.activities);
  const taskRuns = useTaskRunsStore((s) => s.snapshot);
  const workspaceApi = useWorkspaceStore((s) => s.api);
  const indexEntries = useAgentRuntimeIndexStore((s) => s.entries);
  const descriptors = usePanelDescriptorStore((s) => s.descriptors);

  const density = activityDensityFor(size);
  const showList = activityShowList(density);
  const rowLimit = activityRowLimitFor(density, size.h);
  const showMeta = activityShowRowMeta(density, size.w);
  const showFooter = activityShowIndexFooter(density, size.h);

  // 本窗 scope：FA 已按窗过滤；TaskRuns 是本机全量，计数/分组必须带 windowId。
  const thisWindowId = currentElectronWindowId();
  const windowScope =
    thisWindowId === undefined ? undefined : { windowId: thisWindowId };
  const counts = activityOverviewCounts(activities, taskRuns, windowScope);
  const grouped = groupActivityOverviewRows(activities, taskRuns, windowScope);
  const flat = flattenGroupedActivityRows(grouped);
  const limited = flat.slice(0, rowLimit);
  const allowedPanelIds = new Set(limited.map((row) => row.panelId));
  const truncated = flat.length > limited.length;

  const otherWindowAgentCount = indexEntries.filter((entry) =>
    thisWindowId ? entry.windowId !== thisWindowId : false
  ).length;

  const indexProjectByPanel = new Map<string, string>();
  for (const entry of indexEntries) {
    const path = entry.projectRootPath ?? entry.cwd;
    if (path) {
      indexProjectByPanel.set(entry.panelId, path);
    }
  }

  // 同名会话消歧：只在同一屏里确有重复时追加序号，否则原样显示。
  // 范围必须与**实际渲染**的行一致（limited）：若按 flat 计算，被截断掉的
  // 那行会占掉 (1)，用户在屏幕上只看到一个孤零零的「(2)」。
  const agentDisplayTitles = disambiguateAgentSessionTitles(
    limited
      .filter(
        (row): row is ForegroundActivity & { kind: "agent" } =>
          row.kind === "agent"
      )
      .map((row) => ({
        panelId: row.panelId,
        primary: agentActivityRowPrimary(
          row,
          projectPathForActivity(row, descriptors, indexProjectByPanel)
        ),
        spawnedAt: row.spawnedAt,
      }))
  );

  const handleReveal = (activity: ForegroundActivity): void => {
    if (!workspaceApi) {
      return;
    }
    const panelId =
      activity.kind === "task"
        ? revealPanelIdForTaskActivity(activity, taskRuns)
        : activity.panelId;
    const result = activateWorkspacePanel(workspaceApi, panelId, {
      reveal: "always",
    });
    if (!result.ok && result.code === "not_found") {
      toast.error(t("workbench.widget.activityOverview.panelGone"));
    }
  };

  const handleOpenIndex = (): void => {
    openAgentIndexQuickPick().catch(() => undefined);
  };

  // compact（h≤2）：满宽 KPI 条贴顶铺满内容区，不渲染列表 / 大空态 / footer。
  if (!showList) {
    return (
      <div
        className="flex h-full min-h-0 flex-col p-3"
        data-testid="activity-summary-only"
      >
        <ActivitySummary counts={counts} density={density} fill />
      </div>
    );
  }

  const renderRow = (activity: ForegroundActivity): ReactNode => (
    <ActivityRow
      activity={activity}
      displayTitle={agentDisplayTitles.get(activity.panelId)}
      key={activity.panelId}
      onRename={
        activity.kind === "agent"
          ? () => {
              // 初值用未消歧的原始标题：序号只是同屏歧义提示，不该写进用户标题。
              promptRenameAgentSession({
                initialTitle: agentActivityRowPrimary(
                  activity,
                  projectPathForActivity(
                    activity,
                    descriptors,
                    indexProjectByPanel
                  )
                ),
                panelId: activity.panelId,
              }).catch(() => undefined);
            }
          : undefined
      }
      onReveal={() => handleReveal(activity)}
      projectPath={projectPathForActivity(
        activity,
        descriptors,
        indexProjectByPanel
      )}
      showMeta={showMeta}
      taskRuns={taskRuns}
    />
  );

  // 空态：KPI 固定高度 + 空态吃剩余空间。
  // 禁止子项 min-h-full（会变成 KPI 高度 + 100% 父高 → 假溢出滚动条）。
  if (counts.inProgress === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <div className="shrink-0">
          <ActivitySummary counts={counts} density={density} />
        </div>
        <WidgetEmpty
          className="min-h-0"
          hint={t("workbench.widget.activityOverview.emptyHint")}
          icon={PanelsTopLeft}
          title={t("workbench.widget.activityOverview.empty")}
        />
      </div>
    );
  }

  const needsYouRows = rowsInLimit(grouped.needsYou, allowedPanelIds);
  const runningRows = rowsInLimit(grouped.running, allowedPanelIds);
  const otherRows = rowsInLimit(grouped.other, allowedPanelIds);

  // 列表滚动容器必须贴卡片内容区右缘：根节点只保留纵向 padding，
  // 横向间距下放到 KPI / 列表内容 / footer，避免 scrollbar 被 p-3 顶离右边缘。
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 py-3">
      <div className="shrink-0 px-3">
        <ActivitySummary counts={counts} density={density} />
      </div>

      {/* 仅列表区在内容超出时滚动；根节点不 min-h-full 叠高 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-3">
          {needsYouRows.length > 0 ? (
            <Section
              title={t("workbench.widget.activityOverview.section.needsYou")}
            >
              {needsYouRows.map(renderRow)}
            </Section>
          ) : null}
          {runningRows.length > 0 ? (
            <Section
              title={t("workbench.widget.activityOverview.section.running")}
            >
              {runningRows.map(renderRow)}
            </Section>
          ) : null}
          {otherRows.length > 0 ? (
            <Section
              title={t("workbench.widget.activityOverview.section.other")}
            >
              {otherRows.map(renderRow)}
            </Section>
          ) : null}

          {truncated ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              {t("workbench.widget.activityOverview.moreRows", {
                count: flat.length - limited.length,
              })}
            </p>
          ) : null}
        </div>
      </div>

      {showFooter && otherWindowAgentCount > 0 ? (
        <button
          className="mx-3 shrink-0 rounded-md px-1 py-1 text-left text-muted-foreground text-xs transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          data-testid="activity-index-footer"
          onClick={handleOpenIndex}
          type="button"
        >
          {t("workbench.widget.activityOverview.otherWindowsAgents", {
            count: otherWindowAgentCount,
          })}
        </button>
      ) : null}
    </div>
  );
}
