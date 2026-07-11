import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
  closeTerminal(panelId: string): boolean;
  createOutputTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame,
    fontFamilies: string[],
    fontSize: number
  ): boolean;
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame,
    fontFamilies: string[],
    fontSize: number,
    launch: ResolvedTerminalLaunchOptions | undefined,
    lifecycleId: string
  ): boolean;
  debugSnapshot(parentHandle: Buffer): string;
  /** Window 真正销毁时调用一次: closeAll + 卸 EventRouter + 卸 NSEvent monitor */
  detachWindow(parentHandle: Buffer): void;
  finishTerminalOutput(
    panelId: string,
    exitCode: number,
    runtimeMilliseconds: number
  ): boolean;
  hideTerminal(panelId: string): void;
  performTerminalBindingAction(panelId: string, action: string): boolean;
  readSelectionText(panelId: string): string | null;
  /**
   * 孤儿清理:关掉该 window 下不在 activeIds 集合的 terminal NSView. C 方案
   * reload 零销毁路径上, renderer 重建后报告"我现在还需要这些 panelId",
   * swift 把不在集合里的清掉. 空数组 = 全清 (等价 closeAllTerminals).
   */
  reconcileTerminals(parentHandle: Buffer, activeIds: string[]): void;
  /** 把打包字体 ttf 的绝对路径注册给 CoreText (.process scope)，让 ghostty 能找到。启动时调一次。 */
  registerFonts(paths: string[]): void;
  /** 重建同一 panelId 的 host-managed surface，保留 dockview 几何和可见性。 */
  resetTerminalOutput(panelId: string): boolean;
  sendText(panelId: string, text: string): boolean;
  setAppShortcutKeys(keys: string[]): void;
  setCommandFinishedForwardCallback?(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          lifecycleId: string,
          exitCode: number,
          durationNanos: number
        ) => void)
      | null
  ): void;
  setCommandStartedForwardCallback?(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          lifecycleId: string,
          commandLine: string
        ) => void)
      | null
  ): void;
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
  setProcessClosedForwardCallback?(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          lifecycleId: string,
          processAlive: boolean
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
    fontFamilies: string[],
    fontSize: number
  ): void;
  /**
   * 注册 Title forward callback. swift TerminalSurfaceTitleDelegate 收到 OSC 0/2 后调用,
   * 传 (browserWindowId, panelId, title). TUI 应用 (claude / vim / aider) 自定义 title
   * 通道. 与 PWD 路由方式相同, 按 windowId 精准送到对应 BrowserWindow renderer.
   */
  setTitleForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          lifecycleId: string,
          title: string
        ) => void)
      | null
  ): void;
  setupWindow(parentHandle: Buffer, browserWindowId: number): boolean;
  showTerminal(panelId: string): void;
  writeTerminalOutput(panelId: string, data: Buffer): boolean;
}

/**
 * 从 addon 解析路径推导 GHOSTTY_RESOURCES_DIR。
 *
 * 打包后 require.resolve 返回 app.asar 内的虚拟路径；消费方是 Ghostty 原生
 * 代码和它 spawn 的 shell（TERMINFO / ZDOTDIR），走真实文件系统读不了 asar，
 * 必须重写到 asarUnpack 的物理目录 app.asar.unpacked。dev 路径无此段，原样返回。
 */
export function ghosttyResourcesDirFromAddonPath(addonPath: string): string {
  const nativeRoot = dirname(dirname(dirname(addonPath)));
  return join(nativeRoot, "GhosttyResources", "ghostty").replace(
    "/app.asar/",
    "/app.asar.unpacked/"
  );
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
    const addonPath = require.resolve(
      "../../native/build/Release/ghostty_native.node"
    );
    // Ghostty 找 shell-integration 脚本靠 GHOSTTY_RESOURCES_DIR，pier 把脚本
    // 打在 native/GhosttyResources/ghostty/ 下（zsh/bash/fish/nushell/elvish）。
    // 必须在 ghostty native 首次 init 前设，否则会 fallback 到禁用集成。
    process.env.GHOSTTY_RESOURCES_DIR ??=
      ghosttyResourcesDirFromAddonPath(addonPath);
    const addon: NativeAddon = require(addonPath);
    return { addon, error: null };
  } catch (e) {
    return {
      addon: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
