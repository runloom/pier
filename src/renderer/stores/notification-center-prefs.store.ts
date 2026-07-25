import {
  DEFAULT_NOTIFICATION_CENTER_PREFS,
  type NotificationCenterPrefs,
} from "@shared/contracts/notification-center.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { create } from "zustand";

interface NotificationCenterPrefsState {
  _hydrate: (next: NotificationCenterPrefs) => void;
  prefs: NotificationCenterPrefs;
  /** 接受完整对象或基于最新 state 的 patch 函数，避免连点用过期 current 覆盖。 */
  setPrefs: (
    next:
      | NotificationCenterPrefs
      | ((current: NotificationCenterPrefs) => NotificationCenterPrefs)
  ) => Promise<void>;
}

function snapshotFrom(prefs: ProjectPreferences): NotificationCenterPrefs {
  return { ...(prefs.notificationCenter ?? DEFAULT_NOTIFICATION_CENTER_PREFS) };
}

/** 串行化写，避免并发 update 乱序（对齐 agent-attention-preferences.store）。 */
let writeChain: Promise<void> = Promise.resolve();

/**
 * 消息中心偏好镜像（retentionDays / showUnreadBadge / mutedKinds / dndEnabled）。
 * dndEnabled 的写路径唯一走 window.pier.notificationCenter.setDnd（NCS 需要同步
 * 快照广播）；本 store 只管其余字段 + onChanged 水合。
 */
export const useNotificationCenterPrefsStore =
  create<NotificationCenterPrefsState>((set, get) => ({
    prefs: { ...DEFAULT_NOTIFICATION_CENTER_PREFS },

    _hydrate(next) {
      set({ prefs: { ...next } });
    },

    async setPrefs(nextOrUpdater) {
      const run = async (): Promise<void> => {
        const prev = get().prefs;
        const next =
          typeof nextOrUpdater === "function"
            ? nextOrUpdater(prev)
            : nextOrUpdater;
        set({ prefs: { ...next } });
        try {
          const merged = await window.pier.preferences.update({
            notificationCenter: next,
          });
          set({ prefs: snapshotFrom(merged) });
        } catch (err) {
          set({ prefs: prev });
          throw err;
        }
      };

      const queued = writeChain.then(run, run);
      writeChain = queued.then(
        () => undefined,
        () => undefined
      );
      await queued;
    },
  }));

let listenerAttached = false;

function attachListener(): void {
  if (listenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useNotificationCenterPrefsStore.getState()._hydrate(snapshotFrom(next));
  });
  if (!detach) {
    return;
  }
  listenerAttached = true;
}

export async function initNotificationCenterPrefs(): Promise<void> {
  attachListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useNotificationCenterPrefsStore.getState()._hydrate(snapshotFrom(snapshot));
  } catch (err) {
    console.error(
      "[notification-center-prefs.store] init failed; keeping defaults:",
      err
    );
  }
}
