/**
 * 消息中心 Popover 开合态（纯 renderer UI，不进 main 快照）。
 * 铃铛控件与命令面板 `pier.notifications.open` 共用。
 */
import { create } from "zustand";

interface NotificationCenterPopoverState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useNotificationCenterPopoverStore =
  create<NotificationCenterPopoverState>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }));
