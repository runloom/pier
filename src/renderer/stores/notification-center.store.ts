import type {
  AppNotification,
  NotificationCenterSnapshot,
} from "@shared/contracts/notification-center.ts";
import { create } from "zustand";

interface NotificationCenterState {
  apply: (snapshot: NotificationCenterSnapshot) => void;
  dndEnabled: boolean;
  /** 首次快照/广播已应用（水合完成）。dedupe 判定与预览桥依赖此标记。 */
  hydrated: boolean;
  /** ts 倒序（新→旧）。 */
  items: AppNotification[];
  seq: number;
  unreadCount: number;
}

let resolveHydration: (() => void) | null = null;

function createHydrationPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveHydration = resolve;
  });
}

/** 首次水合完成的 promise（启动期 dedupe 判定与预览桥等待用）。 */
// eslint-disable-next-line import/no-mutable-exports
export let notificationCenterHydration = createHydrationPromise();

/** 测试专用：重置水合状态（每个用例可重演「首次水合」）。 */
export function resetNotificationCenterHydrationForTests(): void {
  notificationCenterHydration = createHydrationPromise();
}

/**
 * 消息中心镜像 — main NCS 快照的 renderer 副本。
 * 写入方: NotificationCenterBridge（初始 snapshot pull + 广播 push）。
 * 读取方: NotificationCenterControl（铃铛徽标 + Popover 列表）、systemNotify 门面（DND 判定）。
 * seq 单调守卫拒收乱序广播（对齐 foreground-activity.store 的 ts 守卫）。
 */
export const useNotificationCenterStore = create<NotificationCenterState>(
  (set, get) => ({
    apply: (snapshot) => {
      if (snapshot.seq <= get().seq) {
        return;
      }
      set({
        dndEnabled: snapshot.dndEnabled,
        hydrated: true,
        items: snapshot.items,
        seq: snapshot.seq,
        unreadCount: snapshot.unreadCount,
      });
      resolveHydration?.();
      resolveHydration = null;
    },
    dndEnabled: false,
    hydrated: false,
    items: [],
    // -1 而非 0：main 侧 seq 从 0 起，首个快照 seq=0 必须被接受（0 <= 0 会被拒）。
    // 本守卫不覆盖「main 独立重启而 renderer 存活」——当前架构无此路径
    //（main 重启即整个应用重启，renderer module 一并重载回 -1）。
    seq: -1,
    unreadCount: 0,
  })
);

/** 首拉快照 + 订阅广播；返回 detach（bridge unmount 时调用）。 */
export function initNotificationCenter(): () => void {
  const api = window.pier.notificationCenter;
  const detach = api.onChanged((snapshot) => {
    useNotificationCenterStore.getState().apply(snapshot);
  });
  api
    .snapshot()
    .then((snapshot) => {
      useNotificationCenterStore.getState().apply(snapshot);
    })
    .catch(() => {
      // 首拉失败按「空历史水合」处理：resolve 水合，避免延后的系统事件被永久吞掉。
      useNotificationCenterStore.getState().apply({
        dndEnabled: false,
        items: [],
        seq: 0,
        unreadCount: 0,
      });
    });
  return detach;
}

/**
 * 注意力未读数（铃铛徽标）：只计 warning/error 未读。
 * success/info 是流水记录（照常进 inbox、popover 未读数照算），
 * 但不驱动打扰面——与「severity 在 inbox 读作注意力分级」一致。
 */
export function attentionUnreadCount(
  items: readonly AppNotification[]
): number {
  let count = 0;
  for (const item of items) {
    if (
      !item.read &&
      (item.severity === "warning" || item.severity === "error")
    ) {
      count += 1;
    }
  }
  return count;
}
