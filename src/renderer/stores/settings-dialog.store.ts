import { create } from "zustand";
import type { SettingsSectionId } from "@/pages/settings/data/appearance-nav.ts";

interface SettingsDialogState {
  activeSection: SettingsSectionId;
  close: () => void;
  isOpen: boolean;
  open: () => void;
  /** 打开设置对话框并定位到指定 section(右键「管理状态栏…」等入口用)。 */
  openSection: (section: SettingsSectionId) => void;
  setActiveSection: (section: SettingsSectionId) => void;
  setOpen: (open: boolean) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  activeSection: "appearance",
  close: () => set({ isOpen: false }),
  isOpen: false,
  open: () => set({ isOpen: true }),
  openSection: (activeSection) => set({ activeSection, isOpen: true }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setOpen: (isOpen) => set({ isOpen }),
}));
