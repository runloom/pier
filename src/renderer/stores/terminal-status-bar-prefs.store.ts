/**
 * 终端状态栏用户覆盖的 renderer 镜像 store。
 *
 * main 是唯一数据源:initTerminalStatusBarPrefs 全量拉取 + 订阅
 * TERMINAL_STATUS_BAR_PREFS_CHANGED 广播;写路径在 IPC resolve 后同步 set
 * (发起窗口即时一致,main 内存态已提交),广播兜底其它窗口。
 */
import {
  emptyTerminalStatusBarPrefs,
  type TerminalStatusBarItemOverridePatch,
  type TerminalStatusBarPrefs,
  withItemOverridePatch,
} from "@shared/contracts/terminal-status-bar.ts";
import { create } from "zustand";

interface TerminalStatusBarPrefsState {
  initialized: boolean;
  /** 以 patch 语义更新单项覆盖;合成结果为空时自动改走 resetItem。 */
  patchItemOverride(
    itemId: string,
    patch: TerminalStatusBarItemOverridePatch
  ): Promise<void>;
  prefs: TerminalStatusBarPrefs;
  resetItem(itemId: string): Promise<void>;
}

export const useTerminalStatusBarPrefsStore =
  create<TerminalStatusBarPrefsState>((set, get) => ({
    initialized: false,
    patchItemOverride: async (itemId, patch) => {
      const current = get().prefs.items[itemId];
      const next = withItemOverridePatch(current, patch);
      const prefs =
        next === null
          ? await window.pier.terminalStatusBarPrefs.resetItem(itemId)
          : await window.pier.terminalStatusBarPrefs.setItemOverride(
              itemId,
              next
            );
      set({ prefs });
    },
    prefs: emptyTerminalStatusBarPrefs(),
    resetItem: async (itemId) => {
      const prefs = await window.pier.terminalStatusBarPrefs.resetItem(itemId);
      set({ prefs });
    },
  }));

export async function initTerminalStatusBarPrefs(): Promise<void> {
  window.pier.terminalStatusBarPrefs.onChanged((prefs) => {
    useTerminalStatusBarPrefsStore.setState({ initialized: true, prefs });
  });
  const prefs = await window.pier.terminalStatusBarPrefs.getAll();
  useTerminalStatusBarPrefsStore.setState({ initialized: true, prefs });
}
