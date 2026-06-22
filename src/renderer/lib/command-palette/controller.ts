/**
 * 命令面板控制器: state machine + 栈式导航 (commands → quick-pick → ...)。
 *   - requestId 每次状态切换 +1, UI 端用它判断 "新一轮 session" 重置 query/selection。
 *   - open() 若当前有 quickPick 则先调 onDismiss 还原 preview。
 *   - openQuickPick() 压栈, 不当作 "由关变开"。
 *   - goBack() = Esc: 栈非空弹出上层, 栈空清 mode/quickPick 并关闭 (避免 dismiss
 *     effect 二次触发 onDismiss)。
 *   - close() = 点击遮罩等: 仅置 open=false, 保留 mode/quickPick, 让 UI 的 dismiss
 *     effect 在 open 由 true→false 时补调 onDismiss。
 */
import { create } from "zustand";
import type { QuickPick } from "./types.ts";

export type CommandPaletteMode = "commands" | "quick-pick";

interface SessionState {
  mode: CommandPaletteMode;
  open: boolean;
  quickPick: QuickPick | null;
  requestId: number;
}

interface ControllerState extends SessionState {
  /** 点击遮罩 / 显式 close: 不调 onDismiss, 由 UI dismiss effect 兜底。 */
  close: () => void;
  /** Esc: 栈非空回退一层, 栈空关闭面板。 */
  goBack: () => void;
  openPalette: () => void;
  openQuickPick: (qp: QuickPick) => void;
  setOpen: (open: boolean) => void;
  stack: readonly SessionState[];
  toggle: () => void;
}

const INITIAL: SessionState = {
  open: false,
  requestId: 0,
  mode: "commands",
  quickPick: null,
};

function snapshot(state: ControllerState): SessionState {
  return {
    open: state.open,
    requestId: state.requestId,
    mode: state.mode,
    quickPick: state.quickPick,
  };
}

export const useCommandPaletteController = create<ControllerState>(
  (set, get) => ({
    ...INITIAL,
    stack: [],

    openPalette: () => {
      const state = get();
      if (state.open && state.quickPick?.onDismiss) {
        state.quickPick.onDismiss();
      }
      set({
        open: true,
        requestId: state.requestId + 1,
        mode: "commands",
        quickPick: null,
        stack: [],
      });
    },

    openQuickPick: (qp) => {
      const state = get();
      const nextStack = state.open ? [...state.stack, snapshot(state)] : [];
      set({
        open: true,
        requestId: state.requestId + 1,
        mode: "quick-pick",
        quickPick: qp,
        stack: nextStack,
      });
    },

    goBack: () => {
      const state = get();
      if (!state.open) {
        return;
      }
      if (state.quickPick?.onDismiss) {
        state.quickPick.onDismiss();
      }
      const prev = state.stack.at(-1);
      if (prev) {
        set({
          ...prev,
          open: true,
          requestId: state.requestId + 1,
          stack: state.stack.slice(0, -1),
        });
        return;
      }
      set({
        open: false,
        requestId: state.requestId + 1,
        mode: "commands",
        quickPick: null,
        stack: [],
      });
    },

    close: () => {
      const state = get();
      if (!state.open) {
        return;
      }
      set({
        open: false,
        requestId: state.requestId + 1,
        stack: [],
      });
    },

    toggle: () => {
      if (get().open) {
        get().close();
      } else {
        get().openPalette();
      }
    },

    setOpen: (open) => {
      if (open) {
        get().openPalette();
      } else {
        get().close();
      }
    },
  })
);
