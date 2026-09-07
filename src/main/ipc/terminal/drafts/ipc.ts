import { terminalDraftWriteSchema } from "@shared/contracts/terminal/draft.ts";
import type { IpcMain, WebContents } from "electron";
import { z } from "zod";
import { terminalDraftStore } from "../../../state/terminal-drafts/index.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import { windowRecordIdFor } from "../window-scope.ts";
import { broadcastTerminalDraft, refreshTerminalDraft } from "./broadcast.ts";

const panelSchema = z.string().min(1).max(256);
export function registerTerminalDraftIpc(
  ipcMain: IpcMain,
  windowFromWebContents: (sender: WebContents) => AppWindow | null
): void {
  const owner = (sender: WebContents) => {
    const win = windowFromWebContents(sender);
    if (!win || win.isDestroyed())
      throw new Error("terminal window is unavailable");
    return win;
  };
  ipcMain.handle("pier:terminal:draft-read", (event, panelId: unknown) =>
    refreshTerminalDraft(owner(event.sender), panelSchema.parse(panelId))
  );
  ipcMain.handle(
    "pier:terminal:draft-write",
    async (event, panelId: unknown, input: unknown) => {
      const win = owner(event.sender),
        panel = panelSchema.parse(panelId);
      const draft = await terminalDraftStore().write(
        windowRecordIdFor(win),
        panel,
        terminalDraftWriteSchema.parse(input)
      );
      broadcastTerminalDraft(win, panel, draft);
      return draft;
    }
  );
}
