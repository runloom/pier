import { Button } from "@pier/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "@pier/ui/empty.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { ScrollArea } from "@pier/ui/scroll-area.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import type { TerminalTranscriptTailResult } from "@shared/contracts/terminal.ts";
import { HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { openAppContentDialog } from "@/stores/app-content-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { CORE_TERMINAL_HISTORY_STATUS_ITEM_ID } from "../core-terminal-status-items.ts";
import { terminalStatusItemRegistry } from "../status-bar.tsx";

interface HistoryRequest {
  panelId: string;
  taskId?: string;
  taskRunId?: string;
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function HistoryDialogBody({ request }: { request: HistoryRequest }) {
  const t = useT();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; result: TerminalTranscriptTailResult }
  >({ kind: "loading" });

  useEffect(() => {
    let disposed = false;
    window.pier.terminal
      .transcriptTail({
        panelId: request.panelId,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        ...(request.taskRunId ? { taskRunId: request.taskRunId } : {}),
      })
      .then((result) => {
        if (!disposed) {
          setState({ kind: "ready", result });
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState({
            kind: "ready",
            result: {
              error: error instanceof Error ? error.message : String(error),
              ok: false,
            },
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [request.panelId, request.taskId, request.taskRunId]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const { result } = state;
  if (!result.ok) {
    return (
      <Empty>
        <EmptyTitle>{t("terminal.history.loadFailedTitle")}</EmptyTitle>
        <EmptyDescription>
          {result.error ?? t("terminal.history.loadFailedBody")}
        </EmptyDescription>
      </Empty>
    );
  }
  if (!result.text) {
    return (
      <Empty>
        <EmptyTitle>{t("terminal.history.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("terminal.history.emptyBody")}</EmptyDescription>
      </Empty>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {result.truncated ? (
        <p className="text-muted-foreground text-xs">
          {t("terminal.history.truncatedNotice", {
            totalMb: formatMegabytes(result.totalBytes ?? 0),
          })}
        </p>
      ) : null}
      <ScrollArea className="max-h-[60vh] min-h-40 rounded-md border">
        <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed">
          {result.text}
        </pre>
      </ScrollArea>
    </div>
  );
}

function openHistoryDialog(request: HistoryRequest, title: string): void {
  openAppContentDialog({
    content: () => <HistoryDialogBody request={request} />,
    id: `terminal-history:${request.panelId}`,
    size: "xl",
    title,
  });
}

function HistoryStatusItemView({ panelId }: { panelId: string }) {
  const t = useT();
  const activity = useForegroundActivityStore((s) => s.activities[panelId]);
  const label = t("terminal.history.open");
  return (
    <Button
      aria-label={label}
      className={STATUS_BAR_ITEM_TRIGGER_CLASS}
      data-testid="terminal-history-status-item"
      onClick={() => {
        openHistoryDialog(
          {
            panelId,
            ...(activity?.kind === "task"
              ? { taskId: activity.taskId, taskRunId: activity.runId }
              : {}),
          },
          t("terminal.history.dialogTitle")
        );
      }}
      size="status-bar"
      title={label}
      type="button"
      variant="ghost"
    >
      <HistoryIcon aria-hidden="true" data-icon />
    </Button>
  );
}

/** 注册终端历史入口（热窗之外的完整输出，含跨重启历史）。 */
export function registerTerminalHistoryStatusItem(): () => void {
  return terminalStatusItemRegistry.register({
    id: CORE_TERMINAL_HISTORY_STATUS_ITEM_ID,
    isVisible: () => true,
    render: (ctx) => <HistoryStatusItemView panelId={ctx.panelId} />,
  });
}
