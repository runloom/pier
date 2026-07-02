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
  /** 最近一次 IPC 操作失败的错误消息;操作成功后清空。 */
  error: string | null;
  initialized: boolean;
  /** 以 patch 语义更新单项覆盖;合成结果为空时自动改走 resetItem。 */
  patchItemOverride(
    itemId: string,
    patch: TerminalStatusBarItemOverridePatch
  ): Promise<void>;
  prefs: TerminalStatusBarPrefs;
  resetItem(itemId: string): Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useTerminalStatusBarPrefsStore =
  create<TerminalStatusBarPrefsState>((set, get) => ({
    error: null,
    initialized: false,
    patchItemOverride: async (itemId, patch) => {
      const current = get().prefs.items[itemId];
      const next = withItemOverridePatch(current, patch);
      try {
        const prefs =
          next === null
            ? await window.pier.terminalStatusBarPrefs.resetItem(itemId)
            : await window.pier.terminalStatusBarPrefs.setItemOverride(
                itemId,
                next
              );
        set({ error: null, prefs });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },
    prefs: emptyTerminalStatusBarPrefs(),
    resetItem: async (itemId) => {
      try {
        const prefs =
          await window.pier.terminalStatusBarPrefs.resetItem(itemId);
        set({ error: null, prefs });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },
  }));

export async function initTerminalStatusBarPrefs(): Promise<void> {
  window.pier.terminalStatusBarPrefs.onChanged((prefs) => {
    useTerminalStatusBarPrefsStore.setState({ initialized: true, prefs });
  });
  try {
    const prefs = await window.pier.terminalStatusBarPrefs.getAll();
    useTerminalStatusBarPrefsStore.setState({
      error: null,
      initialized: true,
      prefs,
    });
  } catch (err) {
    useTerminalStatusBarPrefsStore.setState({
      error: errorMessage(err),
      initialized: true,
    });
  }
}
