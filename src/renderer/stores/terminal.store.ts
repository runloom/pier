import { create } from "zustand";
import {
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
} from "./terminal-input-routing-slice.ts";

// ===========================================================================
// slice.overlayFocus — zustand
// ===========================================================================

interface TerminalOverlayFocusSlice {
  activateOverlay(id: string): void;
  activeOverlayId: string | null;
  deactivateOverlay(id: string): void;
  yieldToTerminal(): void;
}

// ===========================================================================
// slice.resize — zustand
// ===========================================================================

interface TerminalResizeSlice {
  /**
   * 上一次 downlink 序号（renderer → main 端已 ack 的 rendererSequence），
   * dismissResizePlaceholder 用它判断当前 pulse 是否已被 main 处理。
   */
  lastDownlinkSequence: number;
  placeholderVisible: boolean;
  suppressTerminals: boolean;
}

// ===========================================================================
// slice.shortcutHints — zustand
// ===========================================================================

interface PanelLike {
  id: string;
}

interface TabShortcutHintsSlice {
  activeGroupTabHints: Record<string, number>;
  commandKeyDown: boolean;
  resetShortcutHints(): void;
  setActiveGroupPanels(panels: readonly PanelLike[]): void;
  setCommandKeyDown(commandKeyDown: boolean): void;
}

function tabHintsForPanels(
  panels: readonly PanelLike[]
): Record<string, number> {
  return Object.fromEntries(
    panels.slice(0, 9).map((panel, index) => [panel.id, index + 1])
  );
}

// ===========================================================================
// 合并 store
// ===========================================================================

type TerminalStoreState = TerminalOverlayFocusSlice &
  TerminalResizeSlice &
  TabShortcutHintsSlice;

/**
 * 单一 web 焦点请求的释放句柄。共存型浮层（如终端搜索）任一时刻只有一个能持有
 * 键盘，激活动作由显式意图驱动（打开、用户点回输入框），终端焦点意图让出键盘但
 * 不关闭浮层。绝不由 DOM focus/blur 事件回写。
 */
let overlayFocusRelease: (() => void) | null = null;

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  // --- overlayFocus ---
  activeOverlayId: null,
  activateOverlay(id) {
    if (get().activeOverlayId === id) {
      return;
    }
    overlayFocusRelease?.();
    overlayFocusRelease = requestTerminalWebFocus(id);
    set({ activeOverlayId: id });
  },
  deactivateOverlay(id) {
    if (get().activeOverlayId !== id) {
      return;
    }
    overlayFocusRelease?.();
    overlayFocusRelease = null;
    set({ activeOverlayId: null });
  },
  yieldToTerminal() {
    if (get().activeOverlayId === null) {
      return;
    }
    overlayFocusRelease?.();
    overlayFocusRelease = null;
    set({ activeOverlayId: null });
  },

  // --- resize ---
  lastDownlinkSequence: 0,
  placeholderVisible: false,
  suppressTerminals: false,

  // --- shortcutHints ---
  activeGroupTabHints: {},
  commandKeyDown: false,
  resetShortcutHints: () =>
    set({ activeGroupTabHints: {}, commandKeyDown: false }),
  setActiveGroupPanels: (panels) =>
    set({ activeGroupTabHints: tabHintsForPanels(panels) }),
  setCommandKeyDown: (commandKeyDown) => set({ commandKeyDown }),
}));

// ===========================================================================
// selector hooks（保留旧接口名称，调用方可直接替换 import 路径）
// ===========================================================================

export function useTerminalOverlayFocus<T>(
  selector: (state: TerminalOverlayFocusSlice) => T
): T {
  return useTerminalStore(selector);
}

export function useTerminalResizeStore<T>(
  selector: (state: TerminalResizeSlice) => T
): T {
  return useTerminalStore(selector);
}

export function useTabShortcutHintsStore<T>(
  selector: (state: TabShortcutHintsSlice) => T
): T {
  return useTerminalStore(selector);
}

// ===========================================================================
// test reset
// ===========================================================================

export function resetTerminalOverlayFocusForTests(): void {
  overlayFocusRelease?.();
  overlayFocusRelease = null;
  useTerminalStore.setState({ activeOverlayId: null });
}

export function resetTerminalStoreForTests(): void {
  resetTerminalInputRoutingForTests();
  resetTerminalOverlayFocusForTests();
  useTerminalStore.setState({
    lastDownlinkSequence: 0,
    placeholderVisible: false,
    suppressTerminals: false,
    activeGroupTabHints: {},
    commandKeyDown: false,
  });
}
