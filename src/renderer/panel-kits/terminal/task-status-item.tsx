import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  TaskBackgroundRunSnapshot,
  TaskBackgroundSnapshot,
  TaskCandidate,
  TaskSpawnMode,
} from "@shared/contracts/tasks.ts";
import {
  Ban,
  CheckCircle2,
  Circle,
  CircleAlert,
  ExternalLink,
  ListChecks,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { useTaskBackgroundStore } from "@/stores/task-background.store.ts";
import {
  rememberTerminalTaskRun,
  type TerminalTaskHistoryEntry,
  terminalTaskHistoryEntries,
  useTerminalTaskHistoryStore,
} from "@/stores/terminal-task-history.store.ts";
import { CORE_TASK_STATUS_ITEM_ID } from "./core-terminal-status-items.ts";
import { terminalStatusItemRegistry } from "./terminal-status-bar.tsx";

type TaskCatalogState =
  | { status: "idle"; tasksById: ReadonlyMap<string, TaskCandidate> }
  | { status: "loading"; tasksById: ReadonlyMap<string, TaskCandidate> }
  | {
      message: string;
      status: "error";
      tasksById: ReadonlyMap<string, TaskCandidate>;
    }
  | { status: "ready"; tasksById: ReadonlyMap<string, TaskCandidate> };

interface TaskStatusRow {
  detail?: string;
  id: string;
  label: string;
  projectRootPath: string;
  runId?: string;
  status: TaskBackgroundRunSnapshot["status"];
  unsupportedReason?: string;
}

type TaskRowStatus = TaskBackgroundRunSnapshot["status"];

const EMPTY_TASK_CATALOG = new Map<string, TaskCandidate>();

function taskStatusForEntry(
  entry: TerminalTaskHistoryEntry,
  snapshot: TaskBackgroundSnapshot
): TaskBackgroundRunSnapshot["status"] {
  return (
    snapshot.runs[entry.projectRootPath]?.[entry.taskId]?.status ?? entry.status
  );
}

function runningTaskCount(
  entries: readonly TerminalTaskHistoryEntry[],
  snapshot: TaskBackgroundSnapshot
): number {
  return entries.filter(
    (entry) => taskStatusForEntry(entry, snapshot) === "running"
  ).length;
}

function taskRows(
  entries: readonly TerminalTaskHistoryEntry[],
  snapshot: TaskBackgroundSnapshot,
  tasksById: ReadonlyMap<string, TaskCandidate>
): TaskStatusRow[] {
  return entries.map((entry) => {
    const task = tasksById.get(entry.taskId);
    return {
      id: entry.taskId,
      label: task?.label ?? entry.label,
      projectRootPath: entry.projectRootPath,
      status: taskStatusForEntry(entry, snapshot),
      ...(task?.unsupportedReason
        ? { unsupportedReason: task.unsupportedReason }
        : {}),
      ...(task ? { detail: commandDetail(task) } : {}),
      ...(!task && entry.detail ? { detail: entry.detail } : {}),
      ...(entry.runId ? { runId: entry.runId } : {}),
    };
  });
}

function commandDetail(task: TaskCandidate): string {
  if (task.commandSpec.kind === "process") {
    return [task.commandSpec.command, ...task.commandSpec.args].join(" ");
  }
  return task.commandSpec.command;
}

function taskActionTestId(prefix: string, taskId: string): string {
  return `${prefix}-${taskId}`;
}

function taskStatusLabelKey(status: TaskRowStatus): string {
  switch (status) {
    case "blocked":
      return "terminal.taskStatus.statusBlocked";
    case "cancelled":
      return "terminal.taskStatus.statusCancelled";
    case "failed":
      return "terminal.taskStatus.statusFailed";
    case "pending":
      return "terminal.taskStatus.statusPending";
    case "running":
      return "terminal.taskStatus.statusRunning";
    case "succeeded":
      return "terminal.taskStatus.statusSucceeded";
    default:
      return "terminal.taskStatus.statusPending";
  }
}

function TaskRowStatusIcon({
  status,
  testId,
}: {
  status: TaskRowStatus;
  testId: string;
}) {
  const t = useT();
  const label = t(taskStatusLabelKey(status));
  const commonClassName =
    "inline-flex size-4 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-3";
  const props = {
    "aria-label": label,
    "data-task-row-status": status,
    "data-testid": testId,
    title: label,
  };
  switch (status) {
    case "blocked":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-warning-fg)]")}
          {...props}
        >
          <CircleAlert
            aria-hidden="true"
            data-testid="task-status-row-blocked-icon"
          />
        </span>
      );
    case "cancelled":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-warning-fg)]")}
          {...props}
        >
          <Ban
            aria-hidden="true"
            data-testid="task-status-row-cancelled-icon"
          />
        </span>
      );
    case "failed":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-danger-fg)]")}
          {...props}
        >
          <CircleAlert
            aria-hidden="true"
            data-testid="task-status-row-failed-icon"
          />
        </span>
      );
    case "pending":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-neutral-fg)]")}
          {...props}
        >
          <Circle
            aria-hidden="true"
            data-testid="task-status-row-pending-icon"
          />
        </span>
      );
    case "running":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-info-fg)]")}
          {...props}
        >
          <Loader2
            aria-hidden="true"
            className="animate-spin"
            data-testid="task-status-row-running-icon"
          />
        </span>
      );
    case "succeeded":
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-success-fg)]")}
          {...props}
        >
          <CheckCircle2
            aria-hidden="true"
            data-testid="task-status-row-succeeded-icon"
          />
        </span>
      );
    default:
      return (
        <span
          className={cn(commonClassName, "text-[var(--status-neutral-fg)]")}
          {...props}
        >
          <Circle
            aria-hidden="true"
            data-testid="task-status-row-pending-icon"
          />
        </span>
      );
  }
}

function TaskActionButton({
  children,
  disabled,
  label,
  onClick,
  testId,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick(): void;
  testId: string;
}) {
  return (
    <Button
      aria-label={label}
      className="text-muted-foreground"
      data-testid={testId}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function TaskStatusItemView({
  panelId,
  projectRootPath,
}: {
  panelId: string;
  projectRootPath?: string | undefined;
}) {
  const t = useT();
  const snapshot = useTaskBackgroundStore((s) => s.snapshot);
  useTerminalTaskHistoryStore((s) => s.version);
  const entries = terminalTaskHistoryEntries(panelId);
  const [open, setOpen] = useState(false);
  const [catalogState, setCatalogState] = useState<TaskCatalogState>({
    status: "idle",
    tasksById: EMPTY_TASK_CATALOG,
  });
  const rows = taskRows(entries, snapshot, catalogState.tasksById);
  const runningCount = runningTaskCount(entries, snapshot);
  const statusKind = runningCount > 0 ? "running" : "idle";
  const label =
    runningCount > 0
      ? t("terminal.taskStatus.running", { count: runningCount })
      : t("terminal.taskStatus.idle");

  useEffect(() => {
    if (!(open && projectRootPath)) {
      return;
    }
    let cancelled = false;
    setCatalogState((current) => ({
      status: "loading",
      tasksById: current.tasksById,
    }));
    window.pier.tasks
      .list({ projectRootPath })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCatalogState({
          status: "ready",
          tasksById: new Map(result.tasks.map((task) => [task.id, task])),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setCatalogState((current) => ({
          message: err instanceof Error ? err.message : String(err),
          status: "error",
          tasksById: current.tasksById,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectRootPath]);

  const spawnTask = (task: TaskStatusRow, mode: TaskSpawnMode) => {
    window.pier.tasks
      .spawn({
        focus: mode === "terminal-tab",
        forceRestart: true,
        mode,
        placement: "active-tab",
        projectRootPath: task.projectRootPath,
        taskId: task.id,
      })
      .then((result) => {
        if (result.status === "started" && mode === "background") {
          rememberTerminalTaskRun({
            label: task.label,
            panelId,
            projectRootPath: task.projectRootPath,
            status: "running",
            taskId: task.id,
            ...(task.detail ? { detail: task.detail } : {}),
            ...(result.runId ? { runId: result.runId } : {}),
          });
        } else if (result.status === "unsupported") {
          toast.error(t("terminal.taskStatus.unsupported"), {
            description: result.message,
          });
        } else if (result.status === "requires-input") {
          toast.error(t("terminal.taskStatus.unsupported"), {
            description: t("terminal.taskStatus.inputsUnsupported"),
          });
        }
      })
      .catch((err: unknown) => {
        toast.error(t("terminal.taskStatus.startFailed"), {
          description: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const renderTaskRows = () => {
    if (catalogState.status === "loading" && rows.length === 0) {
      return (
        <DropdownMenuItem disabled>
          {t("terminal.taskStatus.loading")}
        </DropdownMenuItem>
      );
    }
    if (catalogState.status === "error" && rows.length === 0) {
      return (
        <DropdownMenuItem className="text-destructive" disabled>
          {catalogState.message}
        </DropdownMenuItem>
      );
    }
    if (rows.length === 0) {
      return (
        <DropdownMenuItem disabled>
          {t("terminal.taskStatus.noTasks")}
        </DropdownMenuItem>
      );
    }
    return rows.map((task) => {
      const disabled = Boolean(task.unsupportedReason);
      return (
        <div
          className="flex min-h-10 min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
          data-testid={`task-status-dropdown-item-${task.id}`}
          key={task.id}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-medium">{task.label}</div>
              <TaskRowStatusIcon
                status={task.status}
                testId={`task-status-row-status-${task.id}`}
              />
            </div>
            <div className="truncate text-muted-foreground text-xs">
              {task.unsupportedReason ?? task.detail ?? task.status}
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center gap-0.5">
            <TaskActionButton
              disabled={disabled}
              label={t("terminal.taskStatus.rerunInBackground")}
              onClick={() => spawnTask(task, "background")}
              testId={taskActionTestId("task-status-run-background", task.id)}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
            </TaskActionButton>
            <TaskActionButton
              disabled={disabled}
              label={t("terminal.taskStatus.openInNewTab")}
              onClick={() => spawnTask(task, "terminal-tab")}
              testId={taskActionTestId("task-status-open-terminal", task.id)}
            >
              <ExternalLink aria-hidden="true" data-icon="inline-start" />
            </TaskActionButton>
          </div>
        </div>
      );
    });
  };

  if (entries.length <= 0) {
    return null;
  }

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("terminal.statusBar.item.taskStatus.title")}
          className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground"
          data-task-status={statusKind}
          data-testid="task-status-item"
          size="xs"
          title={t("terminal.statusBar.item.taskStatus.title")}
          type="button"
          variant="ghost"
        >
          {statusKind === "running" ? (
            <Loader2
              aria-hidden="true"
              className="animate-spin"
              data-icon="inline-start"
              data-testid="task-status-running-icon"
            />
          ) : (
            <ListChecks
              aria-hidden="true"
              data-icon="inline-start"
              data-testid="task-status-list-icon"
            />
          )}
          <span className="whitespace-nowrap">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80"
        data-testid="task-status-dropdown"
        sideOffset={6}
      >
        <DropdownMenuLabel>
          {t("terminal.statusBar.item.taskStatus.title")}
        </DropdownMenuLabel>
        <DropdownMenuGroup
          className="max-h-80 overflow-y-auto"
          data-scrollbar="none"
        >
          {renderTaskRows()}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function registerTaskStatusItem(): () => void {
  return terminalStatusItemRegistry.register({
    id: CORE_TASK_STATUS_ITEM_ID,
    isVisible: (ctx) => terminalTaskHistoryEntries(ctx.panelId).length > 0,
    render: (ctx) => (
      <TaskStatusItemView
        panelId={ctx.panelId}
        projectRootPath={ctx.context?.projectRootPath}
      />
    ),
  });
}
