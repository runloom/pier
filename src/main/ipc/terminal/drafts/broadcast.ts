import type { TerminalDraft } from "@shared/contracts/terminal/draft.ts";
import { terminalDraftStore } from "../../../state/terminal-drafts/index.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import { windowRecordIdFor } from "../window-scope.ts";

export function broadcastTerminalDraft(
  win: AppWindow,
  panelId: string,
  draft: TerminalDraft
): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("pier://terminal:draft-changed", { panelId, draft });
}

export async function refreshTerminalDraft(
  win: AppWindow,
  panelId: string
): Promise<TerminalDraft> {
  const draft = await terminalDraftStore().read(
    windowRecordIdFor(win),
    panelId
  );
  broadcastTerminalDraft(win, panelId, draft);
  return draft;
}
