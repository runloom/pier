import { createRequire } from "node:module";
import type {
  TerminalColors,
  TerminalFrame,
  TerminalNativeInputRoutingSnapshot,
  TerminalNativePresentationSnapshot,
  TerminalRuntimeConfig,
} from "@shared/contracts/terminal.ts";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";

export interface NativeAddon {
  applyTerminalInputRouting(
    parentHandle: Buffer,
    snapshot: TerminalNativeInputRoutingSnapshot
  ): void;
  applyTerminalPresentation(
    parentHandle: Buffer,
    snapshot: TerminalNativePresentationSnapshot
  ): void;
  /**
   * 应用 Pier 主题派生的终端配色到指定 window 下的 Ghostty controller.
   * Ghostty 库 controller.setTheme(...) 内部 reconfigure 并立即生效, shell 进程
   * 不重启. 每个 BrowserWindow 一个 controller, 该 window 下所有 terminal panel
   * 共享, 调一次即可.
   */
  applyTerminalTheme(parentHandle: Buffer, colors: TerminalColors): void;
  closeAllTerminals(parentHandle: Buffer): void;
  closeTerminal(panelId: string): void;
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame,
    fontFamily: string,
    fontSize: number,
    launch: ResolvedTerminalLaunchOptions | undefined
  ): boolean;
  debugSnapshot(parentHandle: Buffer): string;
  /** Window 真正销毁时调用一次: closeAll + 卸 EventRouter + 卸 NSEvent monitor */
  detachWindow(parentHandle: Buffer): void;
  hideTerminal(panelId: string): void;
  performTerminalBindingAction(panelId: string, action: string): boolean;
  /**
   * 孤儿清理:关掉该 window 下不在 activeIds 集合的 terminal NSView. C 方案
   * reload 零销毁路径上, renderer 重建后报告"我现在还需要这些 panelId",
   * swift 把不在集合里的清掉. 空数组 = 全清 (等价 closeAllTerminals).
   */
  reconcileTerminals(parentHandle: Buffer, activeIds: string[]): void;
  setAppShortcutKeys(keys: string[]): void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setKeyboardForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          modifierFlags: number,
          chars: string
        ) => void)
      | null
  ): void;
  setModifierForwardCallback(
    cb: ((browserWindowId: number, modifierFlags: number) => void) | null
  ): void;
  setMouseForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          x: number,
          y: number
        ) => void)
      | null
  ): void;
  /**
   * 注册 PWD forward callback. swift TerminalSurfacePwdDelegate 收到 OSC 7 后调用,
   * 传 (browserWindowId, panelId, cwd). 用 windowId 路由到对应 BrowserWindow 的
   * renderer (多窗口下避免广播污染). 传 null 解绑.
   */
  setPwdForwardCallback(
    cb: ((browserWindowId: number, panelId: string, cwd: string) => void) | null
  ): void;
  setSearchForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          total: number,
          selected: number
        ) => void)
      | null
  ): void;
  setTerminalConfig(parentHandle: Buffer, config: TerminalRuntimeConfig): void;
  setTerminalFocusRequestCallback(
    cb: ((browserWindowId: number, panelId: string) => void) | null
  ): void;
  /** 热更新 window 下所有 terminal 的字体. controller per window, 内部走 Ghostty TerminalController.setTerminalConfiguration. */
  setTerminalFont(
    parentHandle: Buffer,
    fontFamily: string,
    fontSize: number
  ): void;
  /**
   * 注册 Title forward callback. swift TerminalSurfaceTitleDelegate 收到 OSC 0/2 后调用,
   * 传 (browserWindowId, panelId, title). TUI 应用 (claude / vim / aider) 自定义 title
   * 通道. 与 PWD 路由方式相同, 按 windowId 精准送到对应 BrowserWindow renderer.
   */
  setTitleForwardCallback(
    cb:
      | ((browserWindowId: number, panelId: string, title: string) => void)
      | null
  ): void;
  setupWindow(parentHandle: Buffer, browserWindowId: number): boolean;
  showTerminal(panelId: string): void;
}

export function loadNativeAddon(): {
  addon: NativeAddon | null;
  error: string | null;
} {
  if (process.platform !== "darwin") {
    return { addon: null, error: "ghostty requires macOS" };
  }
  try {
    const require = createRequire(import.meta.url);
    const addon: NativeAddon = require("../../native/build/Release/ghostty_native.node");
    return { addon, error: null };
  } catch (e) {
    return {
      addon: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
