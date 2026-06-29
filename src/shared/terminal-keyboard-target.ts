import type { TerminalKeyboardFocusTarget } from "./contracts/terminal.ts";

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
