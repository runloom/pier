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

export function textareaSoftWrapped(el: HTMLTextAreaElement): boolean {
  const style = getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return false;
  }
  const paddingY =
    (Number.parseFloat(style.paddingTop) || 0) +
    (Number.parseFloat(style.paddingBottom) || 0);
  const contentHeight = Math.max(0, el.scrollHeight - paddingY);
  return contentHeight / lineHeight >= SOFT_WRAP_LINE_THRESHOLD;
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
  el: HTMLTextAreaElement,
  overlayId: string
): boolean {
  el.focus();
  if (document.activeElement !== el) {
    return false;
  }
  useTerminalStore.getState().activateOverlay(overlayId);
  return true;
}
