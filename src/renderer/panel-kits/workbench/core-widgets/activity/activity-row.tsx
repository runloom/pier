import { Button } from "@pier/ui/button.tsx";
import { formatDurationShort } from "@pier/ui/format.tsx";
import { cn } from "@pier/ui/utils.ts";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  agentSessionTitleInput,
  resolveAgentSessionTitle,
} from "@shared/agent-session-title/index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type {
  TaskRunNodeStatus,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { taskNodeStatusForActivity } from "@shared/task-activity-sources.ts";
import { ListTodo, Pencil, Terminal } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AgentStatusLabel } from "@/components/agent-status/agent-status-label.tsx";
import { useT } from "@/i18n/use-t.ts";
import {
  activityIdentityMetaText,
  activityRowMetaText,
  shortProjectLabel,
} from "./activity-path-label.ts";

const DURATION_TICK_MS = 1000;

function durationLabel(
  stateStartedAt: number | undefined,
  updatedAt: number,
  now: number,
  locale: string
): string {
  const start = stateStartedAt ?? updatedAt;
  const elapsed = Math.max(0, now - start);
  return formatDurationShort(elapsed, locale);
}

function taskStatusKey(
  status: TaskRunNodeStatus | undefined
): string | undefined {
  if (!status) {
    return;
  }
  return `workbench.widget.activityOverview.taskStatus.${status}`;
}

/**
 * Agent 行主标题。路径锚点必传：否则无标题会话的 placeholder 塌成裸 catalog
 * 标签，同 agent 的多个面板行会完全一样。
 */
export function agentActivityRowPrimary(
  activity: ForegroundActivity & { kind: "agent" },
  projectPath: string | undefined
): string {
  return resolveAgentSessionTitle(
    agentSessionTitleInput({
      agentId: activity.agentId,
      projectRootPath: projectPath,
      sessionTitle: activity.sessionTitle,
      sessionTitleSource: activity.sessionTitleSource,
    })
  ).primary;
}

function rowTitle(
  activity: ForegroundActivity,
  projectPath: string | undefined,
  t: (key: string) => string
): string {
  if (activity.kind === "agent") {
    return agentActivityRowPrimary(activity, projectPath);
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

function LeadingIcon({ activity }: { activity: ForegroundActivity }) {
  if (activity.kind === "agent") {
    return <AgentIcon agentId={activity.agentId} size={16} />;
  }
  if (activity.kind === "task") {
    return <ListTodo aria-hidden="true" className="size-4" />;
  }
  return <Terminal aria-hidden="true" className="size-4" />;
}

function isNeedsYouRow(
  activity: ForegroundActivity,
  taskRuns: TaskRunsSnapshot
): boolean {
  if (activity.kind === "agent") {
    return activity.status === "waiting" || activity.status === "error";
  }
  if (activity.kind === "task") {
    const status = taskNodeStatusForActivity(
      taskRuns,
      activity.runId,
      activity.taskId
    );
    return status === "blocked" || status === "failed";
  }
  return false;
}

export function ActivityRow({
  activity,
  displayTitle,
  onRename,
  onReveal,
  projectPath,
  showMeta,
  taskRuns,
}: {
  activity: ForegroundActivity;
  /** 已消歧的展示标题（同名会话追加序号）；缺席时本行自行解析。 */
  displayTitle?: string | undefined;
  /** 仅 agent 行提供：行内改名（`user` 秩，可覆盖任何自动标题）。 */
  onRename?: (() => void) | undefined;
  onReveal: () => void;
  projectPath?: string | undefined;
  showMeta: boolean;
  taskRuns: TaskRunsSnapshot;
}) {
  const t = useT();
  const title = displayTitle ?? rowTitle(activity, projectPath, t);
  const kindLabel = t(
    `workbench.widget.activityOverview.kind.${activity.kind}`
  );
  const needsYou = isNeedsYouRow(activity, taskRuns);
  const stateStartedAt =
    activity.kind === "agent" ? activity.stateStartedAt : undefined;
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 持续时间计时器（每秒刷新）
  // 原依赖 [visible] 会导致 visible=false 时完全不计时（这是本次 bug）
  // 改为 [] 依赖，保证计时器始终运行（仅在组件挂载时启动一次）
  // 即使 widget 可见性状态有小问题，活动总览打开时也能正常显示时间
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), DURATION_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const locale =
    typeof document !== "undefined" &&
    document.documentElement.lang.toLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en";
  const duration = durationLabel(
    stateStartedAt,
    activity.updatedAt,
    nowMs,
    locale
  );

  let statusNode: ReactNode = null;
  if (activity.kind === "agent") {
    statusNode = (
      <AgentStatusLabel
        fallbackLabel={t("workbench.widget.activityOverview.agentLaunching")}
        spawnedAt={activity.spawnedAt}
        stateStartedAt={activity.stateStartedAt}
        status={activity.status}
        subagentCount={activity.subagentCount}
      />
    );
  } else if (activity.kind === "task") {
    const status = taskNodeStatusForActivity(
      taskRuns,
      activity.runId,
      activity.taskId
    );
    const key = taskStatusKey(status);
    if (key) {
      const statusTone =
        status === "failed" || status === "blocked"
          ? "text-destructive"
          : "text-muted-foreground";
      statusNode = (
        <span className={cn("whitespace-nowrap text-[11px]", statusTone)}>
          {t(key)}
        </span>
      );
    }
  }

  const ariaStatus =
    activity.kind === "agent" && activity.status
      ? t(`terminal.agentStatus.${activity.status}`)
      : kindLabel;
  // Agent 行副行说身份（哪个智能体 · 哪个项目 · 是否子会话），不重复 kind；
  // 其他 kind 仍用 kind · 项目。
  const metaText =
    activity.kind === "agent"
      ? activityIdentityMetaText([
          getAgentCatalogEntry(activity.agentId)?.label ?? activity.agentId,
          shortProjectLabel(projectPath),
          activity.actorHint === "subagent" ||
          activity.parentSessionId !== undefined
            ? t("workbench.widget.activityOverview.identity.subagent")
            : undefined,
        ])
      : activityRowMetaText(kindLabel, projectPath);

  return (
    // 改名钮不能嵌在整行 button 里（button 不可嵌套），因此行是 flex 容器：
    // 左侧整面点击区（聚焦面板）+ 右侧独立改名钮。
    <div className="group/activity-row flex w-full items-center rounded-md transition-colors hover:bg-accent/50">
      <button
        aria-label={`${title}, ${metaText}, ${ariaStatus}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1.5 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
        data-testid={`activity-row-${activity.panelId}`}
        onClick={onReveal}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <LeadingIcon activity={activity} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={cn(
                "min-w-0 truncate font-medium text-sm/tight",
                needsYou && "text-destructive"
              )}
            >
              {title}
            </span>
            {statusNode}
          </span>
          {showMeta ? (
            <span className="truncate text-muted-foreground text-xs/tight">
              {metaText}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-muted-foreground text-xs/tight tabular-nums">
          {duration}
        </span>
      </button>

      {onRename ? (
        <Button
          aria-label={t("workbench.widget.activityOverview.renameSession")}
          // 常态不抢注意力：hover / 键盘聚焦时才显形，但始终在无障碍树里。
          className="mr-0.5 ml-1 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/activity-row:opacity-100"
          data-testid={`activity-row-rename-${activity.panelId}`}
          onClick={onRename}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          {/* 纯图标钮：data-icon 不带 inline-* 方位（无并列文本） */}
          <Pencil data-icon />
        </Button>
      ) : null}
    </div>
  );
}
