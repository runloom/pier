import type { MouseEvent } from "react";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import {
  readTerminalDraftText,
  resetTerminalDraftMirrorsForTests,
  writeTerminalDraftText,
} from "@/stores/terminal-drafts.store.ts";
import type { ComposerPassthroughKeyPress } from "./composer-passthrough.ts";

/** 卡片与终端内容 / 状态栏之间的呼吸间距。 */
export const TERMINAL_COMPOSER_GAP_PX = 8;

/**
 * 单行 compact 卡片未实测前的预留高度（h-9 = 36）：首帧缩 native，避免叠层点不中。
 * 必须 ≤ 实际 compact 高度，否则上方空隙会大于下方 GAP。
 */
export const TERMINAL_COMPOSER_RESERVE_HEIGHT_PX = 36;

/** Soft-wrap → expanded when content box exceeds ~1.6 lines. */
const SOFT_WRAP_LINE_THRESHOLD = 1.6;

/** Per-panel draft retained across on-demand open/close. */

/**
 * Per-panel Lexical editor snapshot (editor.toJSON()) retained alongside the
 * plain draft so chips (skill/command/@path/attachment) survive on-demand
 * close/reopen. Restore applies it only when its plain projection matches
 * the persisted draft; otherwise the plain text seeds the editor.
 */
const editorSnapshots = new Map<string, string>();

export function readComposerEditorSnapshot(panelId: string): string | null {
  return editorSnapshots.get(panelId) ?? null;
}

export function writeComposerEditorSnapshot(
  panelId: string,
  json: string
): void {
  editorSnapshots.set(panelId, json);
}

/** Structured review-comments chip meta for remount rehydrate (plain draft alone loses chips). */
export interface ComposerReviewChipDraft {
  readonly count: number;
  readonly label: string;
  readonly payloadText: string;
}

const reviewChipDrafts = new Map<string, ComposerReviewChipDraft>();

export function resetTerminalComposerDraftsForTests(): void {
  resetTerminalDraftMirrorsForTests();
  editorSnapshots.clear();
  reviewChipDrafts.clear();
}

export function readComposerDraft(panelId: string): string {
  return readTerminalDraftText(panelId);
}

export function writeComposerDraft(panelId: string, value: string): void {
  writeTerminalDraftText(panelId, value);
}

export function clearComposerDraft(panelId: string): void {
  writeTerminalDraftText(panelId, "");
  editorSnapshots.delete(panelId);
  reviewChipDrafts.delete(panelId);
}

export function readReviewChipDraft(
  panelId: string
): ComposerReviewChipDraft | null {
  return reviewChipDrafts.get(panelId) ?? null;
}

export function writeReviewChipDraft(
  panelId: string,
  value: ComposerReviewChipDraft
): void {
  reviewChipDrafts.set(panelId, value);
}

export function clearReviewChipDraft(panelId: string): void {
  reviewChipDrafts.delete(panelId);
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

/** Forward a composer passthrough keypress to the panel TUI, reporting failures. */
export function sendComposerPassthroughKeyPress(input: {
  keyPress: ComposerPassthroughKeyPress;
  panelId: string;
  t: (key: string) => string;
}): void {
  window.pier.terminal
    .sendKeyPress({
      keycode: input.keyPress.keycode,
      panelId: input.panelId,
      ...(input.keyPress.mods === undefined
        ? {}
        : { mods: input.keyPress.mods }),
      ...(input.keyPress.text === undefined
        ? {}
        : { text: input.keyPress.text }),
    })
    .then((result) => {
      if (!result.ok) {
        reportComposerSendFailure(input.t, result.error ?? "");
      }
    })
    .catch((err: unknown) => {
      reportComposerSendFailure(
        input.t,
        err instanceof Error ? err.message : String(err)
      );
    });
}

export function focusComposerInput(
  el: HTMLElement,
  overlayId: string
): boolean {
  el.focus();
  if (document.activeElement !== el) {
    return false;
  }
  // Industry convention (Slack/Discord/Cursor, native <textarea>): a
  // programmatic refocus lands the caret at the END of the draft — browsers
  // default to document start when no live selection survived. Callers are
  // regain-keyboard moments only (open/toggle, tab/takeover, card padding);
  // clicks inside the editable position the caret natively instead.
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  useTerminalStore.getState().activateOverlay(overlayId);
  return true;
}

/** Clicking free composer chrome focuses the editor without stealing text selection. */
export function focusComposerFromChrome(
  event: MouseEvent<HTMLDivElement>,
  el: HTMLElement | null,
  overlayId: string
): void {
  const target = event.target;
  if (!(target instanceof Element && el)) return;
  if (
    target.closest(
      "button, a, input, textarea, [role='button'], .composer-attachment-surface"
    )
  )
    return;
  if (el === target || el.contains(target)) return;
  event.preventDefault();
  focusComposerInput(el, overlayId);
}
