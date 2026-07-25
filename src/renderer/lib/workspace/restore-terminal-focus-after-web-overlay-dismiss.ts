/**
 * 非 modal Popover + 全屏 web overlay 关闭后的终端焦点恢复。
 *
 * 背景：点终端本应走 native focus-request（分支 Dropdown 路径），但全屏 overlay
 * 把点击改道到 web 以便 Radix outside-pointerdown 关浮层——native 收不到点击，
 * 键盘会卡在 pier.click / sticky web request 上。
 *
 * 调用时机：fullscreen overlay + sticky web focus 的 cleanup **之后**，且仅当
 * `shouldMarkWebOverlayOutsideDismiss` 在 outside 事件里判定为「终端命中」时。
 * Dialog 让路 / Esc / 点 trigger 自关 / 点其它 web 控件不要 mark。
 */
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import {
  clearTransientWebClickFocus,
  requestTerminalFocusIntent,
} from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/** 按 owner id 记录「本次关闭是否因终端向 outside（需补聚焦）」。 */
const pendingOutsideDismissOwners = new Set<string>();

/**
 * 是否应在 outside 关闭后补终端聚焦。
 * - trigger / 其它明确 web 控件：否（用户留在 web）
 * - `.terminal-anchor` / body / html：是（全屏 overlay 把点终端改道到此）
 * - 其余：否（宁可不补，避免抢文件树/标签等）
 */
export function shouldMarkWebOverlayOutsideDismiss(
  target: EventTarget | null
): boolean {
  if (!(target instanceof Element)) {
    // document / window 等：全屏 overlay 改道后常见落点
    return true;
  }
  if (
    target.closest(
      [
        '[data-slot="popover-trigger"]',
        '[data-slot="dropdown-menu-trigger"]',
        '[data-testid="notification-center-bell"]',
      ].join(", ")
    )
  ) {
    return false;
  }
  if (
    target === document.documentElement ||
    target === document.body ||
    target.closest(".terminal-anchor")
  ) {
    return true;
  }
  return false;
}

/** `onPointerDownOutside` 里：仅终端向命中时 mark。 */
export function markWebOverlayOutsideDismissIfNeeded(
  ownerId: string,
  target: EventTarget | null
): boolean {
  if (!shouldMarkWebOverlayOutsideDismiss(target)) {
    return false;
  }
  pendingOutsideDismissOwners.add(ownerId);
  return true;
}

/** 测试或已确认终端向 outside 时直接 mark（生产路径优先 IfNeeded）。 */
export function markWebOverlayOutsideDismiss(ownerId: string): void {
  pendingOutsideDismissOwners.add(ownerId);
}

/**
 * open effect cleanup 末尾调用：若本次是终端向 outside 关闭则 restore 并返回 true。
 */
export function consumeWebOverlayOutsideDismiss(ownerId: string): boolean {
  if (!pendingOutsideDismissOwners.has(ownerId)) {
    return false;
  }
  pendingOutsideDismissOwners.delete(ownerId);
  return true;
}

/** 测试用：清空 pending 标记。 */
export function resetWebOverlayOutsideDismissForTests(): void {
  pendingOutsideDismissOwners.clear();
}

function resolveActiveTerminalPanelId(): string | null {
  const scope = useKeybindingScope.getState();
  if (scope.activePanelKind === "terminal" && scope.activePanelId) {
    return scope.activePanelId;
  }
  const panel = useWorkspaceStore.getState().api?.activePanel;
  if (panel?.view.contentComponent === "terminal") {
    return panel.id;
  }
  return null;
}

export function restoreTerminalFocusAfterWebOverlayDismiss(): void {
  // 让出终端内共存浮层（搜索栏等）的键盘，但不关浮层本身——对齐 native focus-request 路径
  useTerminalStore.getState().yieldToTerminal();
  const panelId = resolveActiveTerminalPanelId();
  if (panelId) {
    requestTerminalFocusIntent(panelId);
    return;
  }
  clearTransientWebClickFocus();
}
