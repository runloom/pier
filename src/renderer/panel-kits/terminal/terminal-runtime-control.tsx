import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { formatDurationShort } from "@pier/ui/format.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
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
import {
  TerminalRunSelector,
  taskRunPanelNode,
} from "./terminal-run-selector.tsx";
import {
  TerminalRuntimeStatusIcon,
  terminalRuntimeStatusLabelKey,
} from "./terminal-runtime-status.tsx";
import { useTerminalRunSelection } from "./use-terminal-run-selection.ts";
import { isActiveTaskRunStatus } from "./use-terminal-runtime-control-presentation.ts";

function ActionButton({
  disabled,
  icon: Icon,
  label,
  loading = false,
  onClick,
  testId,
  variant = "ghost",
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick(): Promise<void> | void;
  testId?: string;
  variant?: "destructive" | "ghost";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
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
  now,
  onDismissRun,
  panelId,
  runs,
}: {
  now: number;
  onDismissRun(runId: string): void;
  panelId: string;
  runs: readonly TaskRunControlEntry[];
}) {
  const t = useT();
  const { selectedRunId, setSelectedRunId } = useTerminalRunSelection(
    panelId,
    runs
  );
  const [pendingAction, setPendingAction] = useState<"restart" | "stop" | null>(
    null
  );

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

  const stop = async () => {
    setPendingAction("stop");
    try {
      await stopTaskRun(run, force);
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

  const active = isActiveTaskRunStatus(run.status);

  return (
    <fieldset
      aria-label={t("terminal.runtimeControl.controlLabel", { label })}
      className="flex h-9 w-full min-w-0 items-center"
      data-run-id={run.runId}
      data-run-status={run.status}
      data-testid="terminal-runtime-control"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2">
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
          <span
            className="min-w-0 flex-1 truncate font-medium text-xs"
            title={label}
          >
            {label}
          </span>
        )}
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
          className="@[320px]:inline hidden whitespace-nowrap text-muted-foreground text-xs tabular-nums"
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
            className="@[380px]:inline-flex hidden tabular-nums"
            role="meter"
            variant="secondary"
          >
            {t("terminal.runtimeControl.progress", { completed, total })}
          </Badge>
        ) : null}
      </div>

      <Separator className="my-2" orientation="vertical" />
      <div className="flex shrink-0 items-center gap-0.5 px-1">
        {active ? (
          <ActionButton
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
            variant={force ? "destructive" : "ghost"}
          />
        ) : null}
        {!active || run.status === "running" ? (
          <ActionButton
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
          />
        ) : null}
        {run.mode !== "background" && run.status !== "pending" ? (
          <ActionButton
            disabled={pendingAction !== null}
            icon={LocateFixed}
            label={t("terminal.runtimeControl.reveal")}
            onClick={reveal}
            testId="terminal-runtime-control-reveal"
          />
        ) : null}
        <ActionButton
          disabled={pendingAction !== null}
          icon={X}
          label={t("terminal.runtimeControl.dismiss")}
          onClick={() => onDismissRun(run.runId)}
          testId="terminal-runtime-control-dismiss"
        />
      </div>
    </fieldset>
  );
}
