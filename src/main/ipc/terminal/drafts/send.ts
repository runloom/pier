import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import { terminalDraftStore } from "../../../state/terminal-drafts/index.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import { findAppWindowByElectronId } from "../../../windows/identity.ts";
import type { NativeAddon } from "../native-addon.ts";
import { toNativePanelKey } from "../panel-id.ts";
import { nativeTerminalProcesses } from "../process/registry.ts";
import { pasteTerminalText } from "../submit-text.ts";
import { windowRecordIdFor } from "../window-scope.ts";
import { terminalInputNeedsUser } from "./approval.ts";
import { refreshTerminalDraft } from "./broadcast.ts";

export async function sendPersistedTerminalInput(input: {
  win: AppWindow;
  addon: NativeAddon;
  panelId: string;
  text: string;
  submit: boolean;
  draftText?: string | undefined;
}): Promise<TerminalOperationResult> {
  const key = toNativePanelKey(input.win, input.panelId);
  const process = nativeTerminalProcesses.get(key);
  const isCurrent = nativeTerminalProcesses.inputGuard(key);
  if (!isCurrent())
    return { ok: false, error: "terminal process changed or ended" };
  const scope = windowRecordIdFor(input.win),
    store = terminalDraftStore();
  let checkpoint: string | undefined;
  let result: TerminalOperationResult | undefined;
  try {
    checkpoint = await store.beginSend(
      scope,
      input.panelId,
      input.draftText ?? input.text
    );
    if (terminalInputNeedsUser(key, input.addon)) {
      await store.finishSend(scope, input.panelId, checkpoint, "not-delivered");
      await refreshTerminalDraft(input.win, input.panelId);
      return {
        ok: false,
        errorCode: "needs-input",
        error:
          "Complete the confirmation or question in the terminal before sending a task.",
      };
    }
    result = await pasteTerminalText({
      ...input,
      nativePanelId: key,
      isCurrent: () => isCurrent() && !terminalInputNeedsUser(key, input.addon),
    });
    let outcome: "submitted" | "not-delivered" | "unconfirmed" =
      "not-delivered";
    if (result.ok || result.textDelivered) outcome = "unconfirmed";
    if (result.ok && input.submit) outcome = "submitted";
    await store.finishSend(scope, input.panelId, checkpoint, outcome);
    const currentWindow = process
      ? findAppWindowByElectronId(Number(process.nativePanelId.split("::")[0]))
      : input.win;
    if (currentWindow) await refreshTerminalDraft(currentWindow, input.panelId);
    return result;
  } catch (error) {
    if (checkpoint) {
      try {
        await store.finishSend(scope, input.panelId, checkpoint, "unconfirmed");
        const currentWindow = process
          ? findAppWindowByElectronId(
              Number(process.nativePanelId.split("::")[0])
            )
          : input.win;
        if (currentWindow)
          await refreshTerminalDraft(currentWindow, input.panelId);
      } catch {
        // Checkpoint remains for crash recovery if the final write fails.
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(checkpoint && (result?.ok || result?.textDelivered)
        ? { textDelivered: true, errorCode: "unconfirmed" as const }
        : {}),
    };
  }
}
