import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { formatDurationShort } from "@pier/ui/format.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import {
  LocateFixed,
  type LucideIcon,
  OctagonX,
  RotateCcw,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  forceStopAvailable,
  openTaskRunOutput,
  restartTaskRun,
  revealTaskRun,
  stopTaskRun,
  taskRunActionTargetFromRun,
} from "@/lib/actions/task-run-operations.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { useTerminalRunSelection } from "./hooks/use-run-selection.ts";
import { isActiveTaskRunStatus } from "./hooks/use-runtime-control-presentation.ts";
import { TerminalRunSelector, taskRunPanelNode } from "./run-selector.tsx";
import {
  TerminalRuntimeStatusIcon,
  terminalRuntimeStatusLabelKey,
} from "./runtime-status.tsx";

function ActionButton({
  className,
  disabled,
  icon: Icon,
  label,
  loading = false,
  onClick,
  testId,
  tone = "default",
  variant = "ghost",
}: {
  className?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick(): Promise<void> | void;
  testId?: string;
  tone?: "default" | "muted";
  variant?: "destructive" | "ghost";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={className}
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          tone={tone}
          type="button"
          variant={variant}
        >
          {loading ? (
            <Spinner aria-hidden="true" data-icon="inline-start" />
          ) : (
            <Icon aria-hidden="true" data-icon="inline-start" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TerminalRuntimeControl({
  dismissRun,
  now,
  panelId,
  runs,
}: {
  /** 后台终态「关闭」：只收起控制条，不关发起终端。 */
  dismissRun(runId: string): void;
  now: number;
  panelId: string;
  runs: readonly TaskRunControlEntry[];
}) {
  const t = useT();
  const { selectedRunId, setSelectedRunId } = useTerminalRunSelection(
    panelId,
    runs
  );
  const [pendingAction, setPendingAction] = useState<
    "close" | "restart" | "stop" | null
  >(null);

  const run =
    runs.find((candidate) => candidate.runId === selectedRunId) ?? runs[0];
  if (!run) {
    return null;
  }

  const node = taskRunPanelNode(run, panelId);
  const completed = Object.values(run.nodes).filter(
    (candidate) => !isActiveTaskRunStatus(candidate.status)
  ).length;
  const total = Object.keys(run.nodes).length;
  const force = forceStopAvailable(run, now);
  const label = node?.label ?? run.rootTaskId;
  const statusText = t(terminalRuntimeStatusLabelKey(run.status));
  const actionTarget = taskRunActionTargetFromRun(run, panelId, label);
  const duration = formatDurationShort(
    (isActiveTaskRunStatus(run.status) ? now : run.updatedAt) - run.startedAt
  );
  const active = isActiveTaskRunStatus(run.status);

  const stop = async () => {
    setPendingAction("stop");
    try {
      const outcome = await stopTaskRun(run, force);
      if (outcome === "dismiss") {
        // 优雅停止成功：直接收条，不进入「关闭」态。
        dismissRun(run.runId);
      }
    } finally {
      setPendingAction(null);
    }
  };

  const close = async () => {
    setPendingAction("close");
    try {
      if (run.mode === "background") {
        // 方案 A：只收控制条，不关发起终端。
        dismissRun(run.runId);
        return;
      }
      await useWorkspaceStore.getState().closePanel(panelId);
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("terminal.closeFailed"),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const reveal = async () => {
    await revealTaskRun(run);
  };

  const openOutput = async () => {
    await openTaskRunOutput(run, label);
  };

  const restart = async () => {
    setPendingAction("restart");
    try {
      await restartTaskRun(actionTarget);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <fieldset
      aria-label={t("terminal.runtimeControl.controlLabel", { label })}
      // 禁止 w-full / max-w-full：% 相对整面板时会把胶囊撑成整行。
      // 去 UA border/padding；minInlineSize:0 避免 fieldset 默认 min-content 撑破。
      className="m-0 flex h-9 items-center border-0 p-0"
      data-run-id={run.runId}
      data-run-status={run.status}
      data-testid="terminal-runtime-control"
      style={{ minInlineSize: 0 }}
    >
      <div className="flex items-center gap-2 px-2">
        {/* 仅标题限宽截断（rem，非 %）；状态/时长/动作一律 shrink-0 */}
        <div className="max-w-44 shrink">
          {runs.length > 1 ? (
            <TerminalRunSelector
              disabled={pendingAction !== null}
              label={label}
              onValueChange={setSelectedRunId}
              panelId={panelId}
              runs={runs}
              value={run.runId}
            />
          ) : (
            <span className="block truncate font-medium text-xs" title={label}>
              {label}
            </span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label={statusText}
              className="flex shrink-0 items-center"
              role="status"
            >
              <TerminalRuntimeStatusIcon status={run.status} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{statusText}</TooltipContent>
        </Tooltip>
        <span
          aria-label={t("terminal.runtimeControl.duration", { duration })}
          className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
          role="timer"
        >
          {duration}
        </span>
        {total > 1 ? (
          <Badge
            aria-label={t("terminal.runtimeControl.progressLabel", {
              completed,
              total,
            })}
            aria-valuemax={total}
            aria-valuemin={0}
            aria-valuenow={completed}
            className="shrink-0 tabular-nums"
            role="meter"
            variant="secondary"
          >
            {t("terminal.runtimeControl.progress", { completed, total })}
          </Badge>
        ) : null}
      </div>

      <div
        aria-hidden="true"
        className="my-2 w-px shrink-0 self-stretch bg-border"
        data-slot="separator"
      />
      <div className="flex shrink-0 items-center gap-0.5 px-1">
        {active ? (
          <ActionButton
            className={cn(
              "text-action-danger hover:bg-action-danger/10 hover:text-action-danger"
            )}
            disabled={
              pendingAction !== null || (run.status === "stopping" && !force)
            }
            icon={force ? OctagonX : Square}
            label={t(
              force
                ? "terminal.runtimeControl.forceStop"
                : "terminal.runtimeControl.stop"
            )}
            loading={
              pendingAction === "stop" || (run.status === "stopping" && !force)
            }
            onClick={stop}
            testId="terminal-runtime-control-stop"
          />
        ) : (
          <ActionButton
            disabled={pendingAction !== null}
            icon={X}
            label={t(
              run.mode === "background"
                ? "terminal.runtimeControl.dismiss"
                : "terminal.runtimeControl.close"
            )}
            loading={pendingAction === "close"}
            onClick={close}
            testId="terminal-runtime-control-close"
            tone="muted"
          />
        )}
        {!active || run.status === "running" ? (
          <ActionButton
            className={cn(
              "text-action-accent hover:bg-action-accent/10 hover:text-action-accent"
            )}
            disabled={pendingAction !== null}
            icon={RotateCcw}
            label={t("terminal.runtimeControl.restart")}
            loading={pendingAction === "restart"}
            onClick={restart}
            testId="terminal-runtime-control-restart"
          />
        ) : null}
        {run.mode === "background" ? (
          <ActionButton
            disabled={pendingAction !== null}
            icon={SquareTerminal}
            label={t("terminal.runtimeControl.openOutput")}
            onClick={openOutput}
            testId="terminal-runtime-control-open-output"
            tone="muted"
          />
        ) : null}
        {run.mode !== "background" && run.status !== "pending" ? (
          <ActionButton
            disabled={pendingAction !== null}
            icon={LocateFixed}
            label={t("terminal.runtimeControl.reveal")}
            onClick={reveal}
            testId="terminal-runtime-control-reveal"
            tone="muted"
          />
        ) : null}
      </div>
    </fieldset>
  );
}
