import type { IpcMain } from "electron";
import { windowFromWebContents, windowRecordIdFor } from "../window-scope.ts";

export function registerTerminalSessionTitleIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:terminal:set-session-title",
    async (
      event,
      panelId: string,
      input: { title: string; source: "user" }
    ) => {
      const win = windowFromWebContents(event.sender);
      if (!win || typeof panelId !== "string" || panelId.trim().length === 0) {
        return { applied: false, ok: false };
      }
      if (
        !input ||
        typeof input.title !== "string" ||
        input.source !== "user"
      ) {
        return { applied: false, ok: false };
      }
      const { setTerminalPanelSessionTitle } = await import(
        "../../../state/terminal-session-title.ts"
      );
      const { foregroundActivityService } = await import(
        "../../foreground-activity.ts"
      );
      // FA 槽位键 = Electron id；session JSON 键 = record UUID。
      const faWindowId = String(win.id);
      const sessionScope = windowRecordIdFor(win);
      const activity = foregroundActivityService
        .snapshot(faWindowId)
        .activities.find(
          (candidate) =>
            candidate.kind === "agent" && candidate.panelId === panelId
        );
      const sessionId =
        activity?.kind === "agent" ? activity.sessionId?.trim() : undefined;
      const persisted = await setTerminalPanelSessionTitle(
        sessionScope,
        panelId,
        {
          source: input.source,
          ...(sessionId ? { sessionId } : {}),
          title: input.title,
        }
      );
      if (!persisted.ok) {
        return { applied: false, ok: false };
      }
      if (persisted.applied && persisted.title) {
        foregroundActivityService.setAgentSessionTitle(faWindowId, panelId, {
          source: persisted.source ?? input.source,
          ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
          title: persisted.title,
        });
      } else if (persisted.title && persisted.source) {
        foregroundActivityService.hydrateAgentSessionTitle(
          faWindowId,
          panelId,
          {
            source: persisted.source,
            ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
            title: persisted.title,
          }
        );
      }
      return { applied: Boolean(persisted.applied), ok: true };
    }
  );
}
