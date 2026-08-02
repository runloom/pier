import type { TerminalKeyboardFocusTarget } from "./contracts/terminal.ts";

/**
 * document capture pointerdown 的瞬态 web 焦点 id。
 * durable owner（设置/命令面板/composer…）全部释放后不得只剩本 id 钉键盘。
 */
export const TRANSIENT_WEB_CLICK_FOCUS_ID = "pier.click";

/**
 * 焦点仲裁的唯一派生真相：任意活跃浮层 web 焦点请求即把 effective 拉成 web，
 * 否则跟随 basePanel。main / shared 诊断层共用，避免重复实现导致漂移。
 */
export function computeEffectiveKeyboardTarget(
  basePanel: TerminalKeyboardFocusTarget,
  webRequestCount: number
): TerminalKeyboardFocusTarget {
  return webRequestCount > 0 ? { kind: "web" } : basePanel;
}

/** 两个键盘焦点目标语义相等（web↔web 或 同 panelId 的 terminal）。 */
export function sameKeyboardFocusTarget(
  a: TerminalKeyboardFocusTarget,
  b: TerminalKeyboardFocusTarget
): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === "web" || (b.kind === "terminal" && a.panelId === b.panelId))
  );
}

/**
 * 残留 sticky：base 仍是 terminal，且仅剩瞬态 pier.click（无 durable overlay）。
 * 必须有 webRequestIds 才能判定；缺 ids 时返回 false，避免把「设置打开中」当 sticky。
 */
export function isResidualStickyWebFocus(options: {
  basePanel: TerminalKeyboardFocusTarget;
  webRequestCount: number;
  webRequestIds?: readonly string[] | undefined;
}): boolean {
  if (options.basePanel.kind !== "terminal") {
    return false;
  }
  if (options.webRequestCount <= 0) {
    return false;
  }
  const ids = options.webRequestIds;
  if (ids === undefined || ids.length === 0) {
    return false;
  }
  return ids.every((id) => id === TRANSIENT_WEB_CLICK_FOCUS_ID);
}
