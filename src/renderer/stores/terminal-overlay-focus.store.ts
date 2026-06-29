import { create } from "zustand";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing.store.ts";

interface TerminalOverlayFocusState {
  activateOverlay(id: string): void;
  activeOverlayId: string | null;
  deactivateOverlay(id: string): void;
  // called on a terminal focus intent: any active coexisting overlay yields
  // keyboard to the terminal (the overlay stays mounted/visible).
  yieldToTerminal(): void;
}

/**
 * 单一 web 焦点请求的释放句柄。共存型浮层（如终端搜索）任一时刻只有一个能持有
 * 键盘，激活动作由显式意图驱动（打开、用户点回输入框），终端焦点意图让出键盘但
 * 不关闭浮层。绝不由 DOM focus/blur 事件回写。
 */
let release: (() => void) | null = null;

export const useTerminalOverlayFocus = create<TerminalOverlayFocusState>(
  (set, get) => ({
    activeOverlayId: null,
    activateOverlay(id) {
      if (get().activeOverlayId === id) {
        return;
      }
      release?.();
      release = requestTerminalWebFocus(id);
      set({ activeOverlayId: id });
    },
    deactivateOverlay(id) {
      if (get().activeOverlayId !== id) {
        return;
      }
      release?.();
      release = null;
      set({ activeOverlayId: null });
    },
    yieldToTerminal() {
      if (get().activeOverlayId === null) {
        return;
      }
      release?.();
      release = null;
      set({ activeOverlayId: null });
    },
  })
);

export function resetTerminalOverlayFocusForTests(): void {
  release?.();
  release = null;
  useTerminalOverlayFocus.setState({ activeOverlayId: null });
}
