import type { ExternalNavigationResult } from "@shared/contracts/external-navigation.ts";
import { externalNavigationRequestSchema } from "@shared/contracts/external-navigation.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain, WebContents } from "electron";
import type { ExternalNavigationService } from "../services/external-navigation.ts";
import type { AppWindow } from "../windows/app-window.ts";

export interface ExternalNavigationIpcDependencies {
  service: ExternalNavigationService;
  windowForSender(sender: WebContents): AppWindow | null;
}

export function registerExternalNavigationIpc(
  ipcMain: IpcMain,
  dependencies: ExternalNavigationIpcDependencies
): void {
  ipcMain.handle(
    PIER.EXTERNAL_NAVIGATION_OPEN,
    async (event, payload: unknown): Promise<ExternalNavigationResult> => {
      const parsed = externalNavigationRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return { opened: false, reason: "invalid-request" };
      }

      const sender = event.sender;
      const window = dependencies.windowForSender(sender);
      if (
        event.senderFrame !== sender.mainFrame ||
        !window ||
        window.webContents !== sender ||
        sender.isDestroyed() ||
        window.isDestroyed() ||
        !window.isFocused()
      ) {
        return { opened: false, reason: "not-focused" };
      }

      return dependencies.service.open(parsed.data);
    }
  );
}
