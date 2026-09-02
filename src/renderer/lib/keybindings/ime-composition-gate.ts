import { isImePendingLexicalEnter } from "./is-text-input.ts";

/**
 * IME leftover-key lock (chat-composer industry pattern).
 *
 * `event.isComposing` / `keyCode === 229` miss the Enter that some engines
 * fire *after* `compositionend` (Safari always; Chrome CJK often a 229 then a
 * bare Enter). Unlocking on `compositionend` in the same turn treats that
 * leftover as send and `preventDefault`s it — Chromium may then commit the
 * candidate as UTF-8 bytes (U+FFFD × 3 per CJK scalar).
 *
 * Defer unlock to the next macrotask so same-turn leftover Enter is still
 * IME. A real second Enter is a new keypress after keyup, well after the
 * timer. Slack / Notion / ProseMirror / 飞书-class inputs use this lock;
 * MDN's isComposing+229 check is necessary but not sufficient.
 */
export const IME_COMPOSITION_UNLOCK_DELAY_MS = 0;

export interface ImeCompositionGate {
  begin: () => void;
  dispose: () => void;
  end: () => void;
  isHeld: () => boolean;
}

export function createImeCompositionGate(): ImeCompositionGate {
  let held = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  };

  return {
    begin: () => {
      clearTimer();
      held = true;
    },
    dispose: () => {
      clearTimer();
      held = false;
    },
    end: () => {
      clearTimer();
      timer = setTimeout(() => {
        held = false;
        timer = null;
      }, IME_COMPOSITION_UNLOCK_DELAY_MS);
    },
    isHeld: () => held,
  };
}

/**
 * KEY_ENTER: consume without preventDefault / send / menu confirm.
 * `isHeld` covers leftover Enter after compositionend.
 */
export function shouldDeferImeEnter(
  event: KeyboardEvent | null,
  isHeld: () => boolean
): boolean {
  return isHeld() || isImePendingLexicalEnter(event);
}
