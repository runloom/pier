import type {
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import { type IpcMain, Notification } from "electron";

export function registerNotificationIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:notification:system",
    (_event, request: SystemNotificationRequest): SystemNotificationResult => {
      if (!Notification.isSupported()) {
        return { shown: false };
      }
      const notification = new Notification({
        title: request.title,
        ...(request.body ? { body: request.body } : {}),
      });
      notification.show();
      return { shown: true };
    }
  );
}
