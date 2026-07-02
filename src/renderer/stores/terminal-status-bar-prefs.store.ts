/**
 * 终端状态栏用户覆盖的 renderer 镜像 store。
 *
 * main 是唯一数据源:initTerminalStatusBarPrefs 全量拉取 + 订阅
 * TERMINAL_STATUS_BAR_PREFS_CHANGED 广播;写路径在 IPC resolve 后同步 set
 * (发起窗口即时一致,main 内存态已提交),广播兜底其它窗口。
 *
 * F7:patch 合成不再在 renderer 侧做 —— 多个 renderer 并发 read-modify-write
 * 会互相踩踏丢字段(lost update)。改为直传 patch 给 main,main 单线程 IPC
 * 处理天然串行,由 withItemOverridePatch 在那一侧合成(见
 * src/main/state/terminal-status-bar-prefs.ts applyItemOverridePatch)。
 */
import type {
  TerminalStatusBarItemOverridePatch,
  TerminalStatusBarOverridePatches,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import { emptyTerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import { create } from "zustand";

interface TerminalStatusBarPrefsState {
  /** F8:批量 patch 一次 IPC 原子应用(itemId → patch)。失败时置 error 并 rethrow。 */
  applyOverrides(patches: TerminalStatusBarOverridePatches): Promise<void>;
  /** 最近一次 IPC 操作失败的错误消息;操作成功后清空。 */
  error: string | null;
  initialized: boolean;
  /** 以 patch 语义更新单项覆盖 —— 直传给 main,合成交给 main 侧完成(F7)。 */
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
  create<TerminalStatusBarPrefsState>((set) => ({
    applyOverrides: async (patches) => {
      // F9:与 plugin-settings.store 对齐 —— 记录 error 供 UI 订阅后 rethrow,
      // 让调用方(设置页/右键菜单)能感知失败并弹 toast,而不是悄悄吞掉。
      try {
        const prefs =
          await window.pier.terminalStatusBarPrefs.applyOverrides(patches);
        set({ error: null, prefs });
      } catch (err) {
        set({ error: errorMessage(err) });
        throw err;
      }
    },
    error: null,
    initialized: false,
    patchItemOverride: async (itemId, patch) => {
      try {
        const prefs = await window.pier.terminalStatusBarPrefs.setItemOverride(
          itemId,
          patch
        );
        set({ error: null, prefs });
      } catch (err) {
        set({ error: errorMessage(err) });
        throw err;
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
        throw err;
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
