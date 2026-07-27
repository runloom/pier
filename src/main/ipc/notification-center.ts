/**
 * 统一消息中心 IPC：snapshot pull + 系统事件上报 + 已读/DND 写操作。
 *
 * 装配模式对齐 ipc/foreground-activity.ts（模块级单例 + registerXxxIpc）。
 * 快照经 broadcastNotificationCenterChanged 全窗广播；形态 B toast 经
 * sendMessageToastToOneWindow 单窗投递。renderer 镜像 store 以 seq 单调守卫拒收乱序。
 */

import { join } from "node:path";
import {
  DEFAULT_NOTIFICATION_CENTER_PREFS,
  type NotificationCenterPrefs,
  type NotificationReport,
} from "@shared/contracts/notification-center.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app, type IpcMain, type IpcMainInvokeEvent } from "electron";
import type { PierEventBus } from "../app-core/event-bus.ts";
import {
  broadcastNotificationCenterChanged,
  sendMessageToastToOneWindow,
} from "../app-core/window-broadcasts.ts";
import {
  createNotificationCenterService,
  type NotificationCenterService,
} from "../services/notification-center/service.ts";
import { createNotificationHistoryStore } from "../services/notification-center/store.ts";
import { readPreferences, updatePreferences } from "../state/preferences.ts";
import { findAppWindowByWebContents } from "../windows/window-identity.ts";

const log = createLogger("notification-center.ipc");

export type NotificationCenterServiceHandle = NotificationCenterService;

let initPromise: Promise<NotificationCenterService> | null = null;

async function init(): Promise<NotificationCenterService> {
  const history = await createNotificationHistoryStore({
    filePath: join(app.getPath("userData"), "notifications.json"),
  });
  return createNotificationCenterService({
    broadcast: (snapshot) => {
      try {
        broadcastNotificationCenterChanged(snapshot);
      } catch (err) {
        log.warn("broadcast failed", { err });
      }
    },
    deliverToast: (notification, target) => {
      try {
        sendMessageToastToOneWindow(notification, target);
      } catch (err) {
        log.warn("message toast deliver failed", { err });
      }
    },
    history,
    readPrefs: async () => {
      const prefs = await readPreferences();
      return prefs.notificationCenter ?? DEFAULT_NOTIFICATION_CENTER_PREFS;
    },
    writeDnd: async (enabled) => {
      const current = await readPreferences();
      const next: NotificationCenterPrefs = {
        ...(current.notificationCenter ?? DEFAULT_NOTIFICATION_CENTER_PREFS),
        dndEnabled: enabled,
      };
      await updatePreferences({ notificationCenter: next });
    },
  });
}

/**
 * main 内部消息入口（agent-attention 等系统服务的 ingest 通道，不走 IPC）。
 * 未注册 / 初始化失败时静默——消息留存是尽力投递，不阻塞系统事件主路径。
 */
export function ingestHostNotification(report: NotificationReport): void {
  if (!initPromise) {
    return;
  }
  initPromise
    .then((service) => service.ingest(report))
    .catch((err) => {
      log.warn("ingest failed", { err });
    });
}

/**
 * Await the NCS singleton (null when IPC not registered or init failed).
 * Used by host services that need history-aware ingest (e.g. one-shot toast).
 */
export async function getNotificationCenterService(): Promise<NotificationCenterServiceHandle | null> {
  if (!initPromise) {
    return null;
  }
  try {
    return await initPromise;
  } catch {
    return null;
  }
}

export async function flushNotificationCenterHistory(): Promise<void> {
  if (!initPromise) {
    return;
  }
  try {
    await (await initPromise).flush();
  } catch (err) {
    log.warn("flush before quit failed", { err });
  }
}

function originWindowIdFromEvent(
  event: IpcMainInvokeEvent
): string | undefined {
  const win = findAppWindowByWebContents(event.sender);
  if (!win || win.isDestroyed()) {
    return;
  }
  return String(win.id);
}

export function registerNotificationCenterIpc(
  ipcMain: IpcMain,
  args?: { eventBus?: PierEventBus }
): void {
  initPromise ??= init().catch((err) => {
    log.error("init failed", { err });
    throw err;
  });
  const ready = initPromise;

  // 设置页对 notificationCenter 偏好的外部写入（保留策略/静音/徽标）实时同步；
  // dndEnabled 变化由 syncPrefs 决定是否重新广播快照。
  args?.eventBus?.subscribe((event) => {
    if (
      event.type !== "preferences.changed" ||
      !event.changedKeys.includes("notificationCenter")
    ) {
      return;
    }
    ready
      .then((service) =>
        service.syncPrefs(
          event.snapshot.notificationCenter ?? DEFAULT_NOTIFICATION_CENTER_PREFS
        )
      )
      .catch(() => undefined);
  });

  /** 所有 handler 统一等待初始化；初始化失败向调用方抛错（renderer 门面静默兜底）。 */
  const service = () => ready;

  ipcMain.handle(PIER.NOTIFICATION_CENTER_SNAPSHOT, async () =>
    (await service()).snapshot()
  );
  ipcMain.handle(
    PIER.NOTIFICATION_CENTER_REPORT,
    async (event, payload: unknown) => {
      const originWindowId = originWindowIdFromEvent(event);
      return (await service()).ingest(
        payload,
        originWindowId ? { originWindowId } : undefined
      );
    }
  );
  ipcMain.handle(
    PIER.NOTIFICATION_CENTER_MARK_READ,
    async (_event, id: unknown) => {
      if (typeof id === "string" && id.length > 0) {
        (await service()).markRead(id);
      }
    }
  );
  ipcMain.handle(
    PIER.NOTIFICATION_CENTER_MARK_READ_BY_KEY,
    async (_event, dedupeKey: unknown) => {
      if (typeof dedupeKey === "string" && dedupeKey.length > 0) {
        (await service()).markReadByDedupeKey(dedupeKey);
      }
    }
  );
  ipcMain.handle(PIER.NOTIFICATION_CENTER_MARK_ALL_READ, async () => {
    (await service()).markAllRead();
  });
  ipcMain.handle(
    PIER.NOTIFICATION_CENTER_SET_DND,
    async (_event, enabled: unknown) => {
      if (typeof enabled === "boolean") {
        await (await service()).setDnd(enabled);
      }
    }
  );
}
