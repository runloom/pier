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
  /** 清掉 accept 关闭后暂存的回退栈。 */
  clearPendingAcceptStack: () => void;
  /** 点击遮罩 / 显式 close: 不调 onDismiss, 由 UI dismiss effect 兜底。 */
  close: () => void;
  /** accept 已确认后立即视觉关闭，并把当前 picker 暂存给后续异步 openQuickPick 回退。 */
  closeAfterAccept: () => void;
  /** Esc: 栈非空回退一层, 栈空关闭面板。 */
  goBack: () => void;
  openPalette: () => void;
  openQuickPick: (qp: QuickPick) => void;
  replaceQuickPick: (qp: QuickPick) => void;
  /** 延后一拍清暂存栈，让连续 input picker 能在同一异步链里接上回退栈。 */
  schedulePendingAcceptStackClear: () => void;
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
  (set, get) => {
    let pendingAcceptStack: readonly SessionState[] | null = null;
    let pendingAcceptClearTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelPendingAcceptStackClear = () => {
      if (pendingAcceptClearTimer !== null) {
        clearTimeout(pendingAcceptClearTimer);
        pendingAcceptClearTimer = null;
      }
    };

    const clearPendingAcceptStack = () => {
      cancelPendingAcceptStackClear();
      pendingAcceptStack = null;
    };

    const schedulePendingAcceptStackClear = () => {
      cancelPendingAcceptStackClear();
      pendingAcceptClearTimer = setTimeout(() => {
        pendingAcceptClearTimer = null;
        pendingAcceptStack = null;
      }, 0);
    };

    return {
      ...INITIAL,
      stack: [],

      clearPendingAcceptStack,
      schedulePendingAcceptStackClear,

      closeAfterAccept: () => {
        const state = get();
        if (!state.open) {
          return;
        }
        cancelPendingAcceptStackClear();
        pendingAcceptStack = [...state.stack, snapshot(state)];
        set({
          open: false,
          requestId: state.requestId + 1,
          stack: [],
        });
      },

      openPalette: () => {
        clearPendingAcceptStack();
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
        const nextStack = state.open
          ? [...state.stack, snapshot(state)]
          : (pendingAcceptStack ?? []);
        clearPendingAcceptStack();
        set({
          open: true,
          requestId: state.requestId + 1,
          mode: "quick-pick",
          quickPick: qp,
          stack: nextStack,
        });
      },

      replaceQuickPick: (qp) => {
        if (!get().open) {
          return;
        }
        set({
          mode: "quick-pick",
          quickPick: qp,
        });
      },

      goBack: () => {
        clearPendingAcceptStack();
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
        clearPendingAcceptStack();
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
    };
  }
);
