import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";

/** 卡片与终端内容 / 状态栏之间的呼吸间距。 */
export const TERMINAL_COMPOSER_GAP_PX = 8;

/**
 * 单行卡片未实测前的预留高度（编辑行 + 底栏）：首帧缩 native，避免叠层点不中。
 */
export const TERMINAL_COMPOSER_RESERVE_HEIGHT_PX = 48;

/** Soft-wrap → expanded when content box exceeds ~1.6 lines. */
const SOFT_WRAP_LINE_THRESHOLD = 1.6;

/** Per-panel draft retained across on-demand open/close. */
const drafts = new Map<string, string>();

export function resetTerminalComposerDraftsForTests(): void {
  drafts.clear();
}

export function readComposerDraft(panelId: string): string {
  return drafts.get(panelId) ?? "";
}

export function writeComposerDraft(panelId: string, value: string): void {
  drafts.set(panelId, value);
}

export function clearComposerDraft(panelId: string): void {
  drafts.delete(panelId);
}

/**
 * Detect soft-wrapped multi-line content inside the composer editable.
 *
 * Measure the Lexical paragraph (or first block), not the contenteditable
 * shell. Compact chrome forces `h-full` on the editable (~36px); with a
 * shorter line-height than the shell that makes `scrollHeight / lineHeight ≥ 1.6`
 * even when empty, oscillating compact ↔ expanded and flashing the chrome.
 */
export function elementSoftWrapped(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return false;
  }

  const block = el.querySelector(":scope > p, :scope p");
  const target = block instanceof HTMLElement ? block : el;
  const targetStyle = target === el ? style : getComputedStyle(target);
  const paddingY =
    (Number.parseFloat(targetStyle.paddingTop) || 0) +
    (Number.parseFloat(targetStyle.paddingBottom) || 0);
  const contentHeight = Math.max(0, target.scrollHeight - paddingY);
  return contentHeight / lineHeight >= SOFT_WRAP_LINE_THRESHOLD;
}

/** @deprecated Prefer elementSoftWrapped — kept for call-site migration. */
export function textareaSoftWrapped(el: HTMLTextAreaElement): boolean {
  return elementSoftWrapped(el);
}

export function reportComposerSendFailure(
  t: (key: string) => string,
  detail: string
): void {
  showAppAlert({
    body: detail,
    title: t("terminal.composer.sendFailed"),
  }).catch(() => undefined);
}

export function focusComposerInput(
  el: HTMLElement,
  overlayId: string
): boolean {
  el.focus();
  if (document.activeElement !== el) {
    return false;
  }
  useTerminalStore.getState().activateOverlay(overlayId);
  return true;
}
