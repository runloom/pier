import i18next from "i18next";
import { disposeTerminalComposerSession } from "@/panel-kits/terminal/composer/session.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { clearTaskRunSelectionForPanel } from "@/stores/task-run-selection.store.ts";
import { clearTerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";
import {
  flushTerminalDraft,
  forgetTerminalDraft,
} from "./terminal-drafts.store.ts";

export async function closeNativeTerminalPanel(
  panelId: string
): Promise<boolean> {
  try {
    await flushTerminalDraft(panelId);
    await window.pier.terminal.close(panelId);
    disposeTerminalComposerSession(panelId);
    forgetTerminalDraft(panelId);
    clearTerminalRelaunchRequest(panelId);
    clearTaskRunSelectionForPanel(panelId);
    return true;
  } catch (error) {
    showAppAlert({
      title: i18next.t("terminal.closeFailed"),
      body: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
