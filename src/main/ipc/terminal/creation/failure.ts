import type { CreateTerminalResult } from "@shared/contracts/terminal.ts";
import { clearTerminalPanelAgent } from "../../../state/terminal-session-state.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import { foregroundActivityService } from "../../foreground-activity.ts";
import {
  type NativeTerminalProcess,
  nativeTerminalProcesses,
} from "../process/registry.ts";
/** Failed/superseded preflight cannot clear a replacement or a live surface. */
export async function handleTerminalCreateFailure({
  err,
  settleInitialInput,
  nativeProcess,
  creationIsCurrent,
  restoredAgentLaunch,
  sessionScope,
  panelId,
  win,
}: {
  err: unknown;
  settleInitialInput: ((created: boolean) => Promise<void>) | undefined;
  nativeProcess: NativeTerminalProcess | undefined;
  creationIsCurrent: () => boolean;
  restoredAgentLaunch: boolean;
  sessionScope: string;
  panelId: string;
  win: AppWindow;
}): Promise<CreateTerminalResult> {
  if (settleInitialInput) {
    try {
      await settleInitialInput(nativeProcess?.created === true);
    } catch (draftError) {
      console.error(
        "[terminal] initial input checkpoint retained:",
        draftError
      );
    }
  }
  if (nativeProcess && !nativeProcess.created)
    nativeTerminalProcesses.failed(
      nativeProcess,
      err instanceof Error ? err.message : String(err)
    );
  const ownsCreation =
    creationIsCurrent() &&
    (!nativeProcess || nativeTerminalProcesses.isCurrent(nativeProcess));
  if (ownsCreation && !nativeProcess?.created)
    foregroundActivityService.panelClosed(panelId, String(win.id));
  if (ownsCreation && !(restoredAgentLaunch || nativeProcess?.created)) {
    await clearTerminalPanelAgent(sessionScope, panelId);
  }
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  };
}
