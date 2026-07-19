import type {
  OpenSystemNotificationSettingsResult,
  SystemNotificationPermissionSnapshot,
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierNotificationsAPI {
  getPermissionStatus: () => Promise<SystemNotificationPermissionSnapshot>;
  onPermissionChanged: (
    cb: (snapshot: SystemNotificationPermissionSnapshot) => void
  ) => () => void;
  openSystemSettings: () => Promise<OpenSystemNotificationSettingsResult>;
  sendTest: () => Promise<SystemNotificationResult>;
  system: (
    request: SystemNotificationRequest
  ) => Promise<SystemNotificationResult>;
}

export const notificationsApi: PierNotificationsAPI = {
  getPermissionStatus: () =>
    ipcRenderer.invoke(PIER.SYSTEM_NOTIFICATION_PERMISSION),
  onPermissionChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: SystemNotificationPermissionSnapshot
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(
      PIER_BROADCAST.SYSTEM_NOTIFICATION_PERMISSION_CHANGED,
      listener
    );
    return () => {
      ipcRenderer.off(
        PIER_BROADCAST.SYSTEM_NOTIFICATION_PERMISSION_CHANGED,
        listener
      );
    };
  },
  openSystemSettings: () =>
    ipcRenderer.invoke(PIER.SYSTEM_NOTIFICATION_OPEN_SETTINGS),
  sendTest: () => ipcRenderer.invoke(PIER.SYSTEM_NOTIFICATION_TEST),
  system: (request) => ipcRenderer.invoke("pier:notification:system", request),
};
