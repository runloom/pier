import { formatDurationShort } from "@pier/ui/format.tsx";
import { cn } from "@pier/ui/utils.ts";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
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
import { ListTodo, Terminal } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AgentStatusLabel } from "@/components/agent-status/agent-status-label.tsx";
import { useT } from "@/i18n/use-t.ts";
import { activityRowMetaText } from "./activity-path-label.ts";

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

function rowTitle(
  activity: ForegroundActivity,
  t: (key: string) => string
): string {
  if (activity.kind === "agent") {
    return resolveAgentSessionTitle(
      agentSessionTitleInput({
        agentId: activity.agentId,
        sessionTitle: activity.sessionTitle,
        sessionTitleSource: activity.sessionTitleSource,
      })
    ).primary;
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
  onReveal,
  projectPath,
  showMeta,
  taskRuns,
}: {
  activity: ForegroundActivity;
  onReveal: () => void;
  projectPath?: string | undefined;
  showMeta: boolean;
  taskRuns: TaskRunsSnapshot;
}) {
  const t = useT();
  const title = rowTitle(activity, t);
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
  const metaText = activityRowMetaText(kindLabel, projectPath);

  return (
    <button
      aria-label={`${title}, ${ariaStatus}`}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-accent/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  );
}
