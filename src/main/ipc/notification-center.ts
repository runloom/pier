/**
 * 统一消息中心 IPC：snapshot pull + 系统事件上报 + 已读/DND 写操作。
 *
 * 装配模式对齐 ipc/foreground-activity.ts（模块级单例 + registerXxxIpc）。
 * 快照经 broadcastNotificationCenterChanged 全窗广播；形态 B toast 经
 * sendMessageToastToOneWindow 单窗投递；OS 经 createDeliverOs 进程级投递。
 */

import { join } from "node:path";
import { createDeliverOs } from "@main/services/notification-center/deliver-os.ts";
import { createDeliverToast } from "@main/services/notification-center/deliver-toast.ts";
import { parseAgentRef } from "@shared/contracts/agent/runtime-index.ts";
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
  sendAttentionSoundPlayToOneWindow,
  sendMessageToastToOneWindow,
} from "../app-core/window-broadcasts.ts";
import { getAgentAttentionSettingsCached } from "../services/agent-attention/settings-cache.ts";
import type { AgentRuntimeIndexService } from "../services/agent-runtime-index/index.ts";
import {
  createNotificationCenterService,
  type NotificationCenterService,
} from "../services/notification-center/service.ts";
import { createNotificationHistoryStore } from "../services/notification-center/store.ts";
import { readPreferences, updatePreferences } from "../state/preferences.ts";
import { findAppWindowByWebContents } from "../windows/identity.ts";
import { windowManager } from "../windows/manager.ts";
import { isTargetAgentPanelFocused } from "./notification-center-agent-focus.ts";
import { terminalFocusCoordinator } from "./terminal/focus-coordinator.ts";

const log = createLogger("notification-center.ipc");

export type NotificationCenterServiceHandle = NotificationCenterService;

let initPromise: Promise<NotificationCenterService> | null = null;
/** 初始化完成后的同步句柄（control.snapshot / 命令面热路径只读）。 */
let readyService: NotificationCenterService | null = null;
let runtimeIndex: AgentRuntimeIndexService | null = null;

/** 在 registerAgentRuntimeHost 之后注入，供 OS click 深链。 */
export function bindNotificationCenterRuntimeIndex(
  index: AgentRuntimeIndexService
): void {
  runtimeIndex = index;
}

function isTargetPanelFocused(
  electronWindowId: string,
  panelId: string
): boolean {
  const focused = windowManager.getFocused();
  if (!focused || focused.isDestroyed()) {
    return isTargetAgentPanelFocused({
      activeTerminalPanelId: null,
      focusedElectronWindowId: null,
      ownerElectronWindowId: electronWindowId,
      panelId,
    });
  }
  return isTargetAgentPanelFocused({
    activeTerminalPanelId:
      terminalFocusCoordinator.activeTerminalPanelId(focused),
    focusedElectronWindowId: String(focused.id),
    ownerElectronWindowId: electronWindowId,
    panelId,
  });
}

function isOwnerWindowFocused(electronWindowId: string): boolean {
  const win = windowManager
    .getAll()
    .find((w) => String(w.id) === electronWindowId);
  return Boolean(win && !win.isDestroyed() && win.isFocused());
}

async function init(): Promise<NotificationCenterService> {
  const history = await createNotificationHistoryStore({
    filePath: join(app.getPath("userData"), "notifications.json"),
  });

  let serviceRef: NotificationCenterService | null = null;
  const deliverOsImpl = createDeliverOs({
    getAttentionSettings: () => getAgentAttentionSettingsCached(),
    getIndex: () => runtimeIndex,
    markReadByDedupeKey: (dedupeKey) => {
      serviceRef?.markReadByDedupeKey(dedupeKey);
    },
  });
  const deliverToastImpl = createDeliverToast({
    getAttentionSettings: () => getAgentAttentionSettingsCached(),
    sendToast: sendMessageToastToOneWindow,
    sendSoundToWindow: sendAttentionSoundPlayToOneWindow,
  });

  const service = await createNotificationCenterService({
    broadcast: (snapshot) => {
      try {
        broadcastNotificationCenterChanged(snapshot);
      } catch (err) {
        log.warn("broadcast failed", { err });
      }
    },
    deliverToast: (notification, target) => {
      try {
        deliverToastImpl(notification, target);
      } catch (err) {
        log.warn("message toast deliver failed", { err });
      }
    },
    deliverOs: (notification, meta) => deliverOsImpl(notification, meta),
    history,
    readFocusBase: () => {
      const focused = windowManager.getFocused();
      return {
        hasFocusedPierWindow: Boolean(focused && !focused.isDestroyed()),
      };
    },
    resolveAgentFocus: ({ agentRef, panelId }) => {
      const parsed = agentRef ? parseAgentRef(agentRef) : null;
      const windowId = parsed?.windowId;
      const resolvedPanelId = panelId ?? parsed?.panelId;
      if (!(windowId && resolvedPanelId)) {
        return {};
      }
      return {
        isOwnerWindowFocused: isOwnerWindowFocused(windowId),
        isTargetPanelFocused: isTargetPanelFocused(windowId, resolvedPanelId),
      };
    },
    readAgentAttentionPrefs: () => {
      const s = getAgentAttentionSettingsCached();
      return {
        cooldownMs: s.cooldownMs,
        enableErrorAttention: s.enableErrorAttention,
        enabled: s.enabled,
        turnNotifyMode: s.turnNotifyMode,
      };
    },
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

  serviceRef = service;
  readyService = service;
  return service;
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
 * FA 发布后剪枝 OS 冷却：已下线 agentRef 的占坑/冷却清掉，重开面板视为新会话。
 */
export function pruneNotificationOsCooldown(
  liveAgentRefs: ReadonlySet<string>
): void {
  if (!initPromise) {
    return;
  }
  initPromise
    .then((service) => {
      service.pruneOsCooldown(liveAgentRefs);
    })
    .catch((err) => {
      log.warn("prune os cooldown failed", { err });
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

/** 同步窥视已就绪 NCS；未 init 或失败返回 null（不 await）。 */
export function peekNotificationCenterService(): NotificationCenterServiceHandle | null {
  return readyService;
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
