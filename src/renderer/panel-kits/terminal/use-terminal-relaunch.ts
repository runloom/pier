import { useEffect } from "react";
import { rejectTerminalLaunch } from "@/lib/workspace/terminal-launch-confirmation.ts";
import type { TerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";
import type { ActiveTerminalLaunch } from "./terminal-panel-params.ts";

interface UseTerminalRelaunchArgs {
  activeSequence: number;
  clearTerminalError(): void;
  panelId: string;
  relaunchRequest: TerminalRelaunchRequest | null;
  sessionReadVersionRef: { current: number };
  setActiveLaunch(launch: ActiveTerminalLaunch): void;
  setNativeTerminalReady(ready: boolean): void;
  setSavedSession(session: null): void;
  showTerminalError(message: string): void;
}

export function useTerminalRelaunch({
  activeSequence,
  clearTerminalError,
  panelId,
  relaunchRequest,
  sessionReadVersionRef,
  setActiveLaunch,
  setNativeTerminalReady,
  setSavedSession,
  showTerminalError,
}: UseTerminalRelaunchArgs): void {
  useEffect(() => {
    if (!relaunchRequest || relaunchRequest.sequence === activeSequence) {
      return;
    }
    let disposed = false;
    sessionReadVersionRef.current += 1;
    clearTerminalError();
    setNativeTerminalReady(false);
    setSavedSession(null);
    window.pier.terminal
      .close(panelId, { reason: "relaunch" })
      .then(() => {
        if (disposed) {
          rejectTerminalLaunch(
            relaunchRequest.launchId,
            "terminal panel closed before relaunch completed"
          );
          return;
        }
        setActiveLaunch({
          context: relaunchRequest.context,
          initialInput: relaunchRequest.initialInput,
          launchId: relaunchRequest.launchId,
          sequence: relaunchRequest.sequence,
          tab: relaunchRequest.tab,
          task: relaunchRequest.task,
          taskOutput: undefined,
        });
      })
      .catch((error: unknown) => {
        console.error(`[terminal-panel] relaunch ${panelId} failed:`, error);
        rejectTerminalLaunch(
          relaunchRequest.launchId,
          error instanceof Error ? error : String(error)
        );
        if (!disposed) {
          showTerminalError(
            error instanceof Error ? error.message : String(error)
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    activeSequence,
    clearTerminalError,
    panelId,
    relaunchRequest,
    sessionReadVersionRef,
    setActiveLaunch,
    setNativeTerminalReady,
    setSavedSession,
    showTerminalError,
  ]);
}
