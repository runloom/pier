import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { computeMonoFontFamily } from "@/stores/font.store.ts";
import {
  RestoredAgentResultView,
  RestoredTaskResultView,
} from "./terminal-restored-result-view.tsx";
import { TerminalSurfacePlaceholder } from "./terminal-surface-placeholder.tsx";

interface TerminalPanelBodyProps {
  activeTask: TaskPanelMetadata | undefined;
  anchorRef: RefObject<HTMLDivElement | null>;
  effectiveMonoFontSize: number;
  error: string | null;
  errorRetryable: boolean;
  forceStoppedRun: { updatedAt: number } | undefined;
  monoFontFamily: string;
  nativeTerminalReady: boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onRestartAgent?: (() => void | Promise<void>) | undefined;
  onRetry: () => void;
  resizePlaceholderVisible: boolean;
  restoredAgentResult: TerminalAgentPanelMetadata | undefined;
  restoredTaskResult: TaskPanelMetadata | undefined;
  terminalContentClassName: string;
}

export function TerminalPanelBody({
  activeTask,
  anchorRef,
  effectiveMonoFontSize,
  error,
  errorRetryable,
  forceStoppedRun,
  monoFontFamily,
  nativeTerminalReady,
  onContextMenu,
  onRestartAgent,
  onRetry,
  resizePlaceholderVisible,
  restoredAgentResult,
  restoredTaskResult,
  terminalContentClassName,
}: TerminalPanelBodyProps): ReactNode {
  const showPlaceholder =
    !error && (!nativeTerminalReady || resizePlaceholderVisible);
  const fontFamily = computeMonoFontFamily(monoFontFamily);

  if (forceStoppedRun && activeTask) {
    return (
      <RestoredTaskResultView
        className={terminalContentClassName}
        fontFamily={fontFamily}
        fontSize={effectiveMonoFontSize}
        onContextMenu={onContextMenu}
        task={{
          ...activeTask,
          finishedAt: forceStoppedRun.updatedAt,
          status: "cancelled",
        }}
      />
    );
  }
  if (restoredTaskResult) {
    return (
      <RestoredTaskResultView
        className={terminalContentClassName}
        fontFamily={fontFamily}
        fontSize={effectiveMonoFontSize}
        onContextMenu={onContextMenu}
        task={restoredTaskResult}
      />
    );
  }
  if (restoredAgentResult) {
    return (
      <RestoredAgentResultView
        agent={restoredAgentResult}
        className={terminalContentClassName}
        fontFamily={fontFamily}
        fontSize={effectiveMonoFontSize}
        onRestart={onRestartAgent}
      />
    );
  }
  return (
    <>
      <div
        className={cn("terminal-anchor", terminalContentClassName)}
        ref={anchorRef}
      />
      {showPlaceholder ? (
        <TerminalSurfacePlaceholder className={terminalContentClassName} />
      ) : null}
      {error ? (
        <div
          className={cn(
            terminalContentClassName,
            "flex flex-col items-center justify-center gap-3 bg-[var(--terminal-background,var(--background))] px-4 text-center"
          )}
        >
          <p className="text-muted-foreground text-sm">{error}</p>
          {errorRetryable ? (
            <Button onClick={onRetry} size="sm" type="button">
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
