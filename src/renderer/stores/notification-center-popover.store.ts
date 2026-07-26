/**
 * 消息中心 Popover 开合态（纯 renderer UI，不进 main 快照）。
 * 铃铛控件、命令面板与默认快捷键 `pier.notifications.open` 共用。
 */
import { create } from "zustand";

interface NotificationCenterPopoverState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** 快捷键：已开则关、已关则开。 */
  toggle: () => void;
}

export const useNotificationCenterPopoverStore =
  create<NotificationCenterPopoverState>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
    toggle: () => set((state) => ({ open: !state.open })),
  }));
