export const TERMINAL_OPEN_COMPOSER_EVENT = "pier:terminal:open-composer";
export const TERMINAL_CLOSE_COMPOSER_EVENT = "pier:terminal:close-composer";
export const TERMINAL_COMPOSER_ATTACH_EVENT = "pier:terminal:composer-attach";

export interface TerminalComposerEventDetail {
  panelId: string;
}

/** Dispatches the composer toggle for a panel (open ↔ close). */
export function dispatchTerminalOpenComposer(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent<TerminalComposerEventDetail>(TERMINAL_OPEN_COMPOSER_EVENT, {
      detail: { panelId },
    })
  );
}

export function dispatchTerminalCloseComposer(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent<TerminalComposerEventDetail>(
      TERMINAL_CLOSE_COMPOSER_EVENT,
      {
        detail: { panelId },
      }
    )
  );
}

/** Open Rich Input if needed, then run the file picker for attachments. */
export function dispatchTerminalComposerAttach(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent<TerminalComposerEventDetail>(
      TERMINAL_COMPOSER_ATTACH_EVENT,
      {
        detail: { panelId },
      }
    )
  );
}

export function isTerminalOpenComposerEvent(
  event: Event
): event is CustomEvent<TerminalComposerEventDetail> {
  return (
    event.type === TERMINAL_OPEN_COMPOSER_EVENT &&
    event instanceof CustomEvent &&
    typeof event.detail?.panelId === "string"
  );
}

export function isTerminalCloseComposerEvent(
  event: Event
): event is CustomEvent<TerminalComposerEventDetail> {
  return (
    event.type === TERMINAL_CLOSE_COMPOSER_EVENT &&
    event instanceof CustomEvent &&
    typeof event.detail?.panelId === "string"
  );
}

export function isTerminalComposerAttachEvent(
  event: Event
): event is CustomEvent<TerminalComposerEventDetail> {
  return (
    event.type === TERMINAL_COMPOSER_ATTACH_EVENT &&
    event instanceof CustomEvent &&
    typeof event.detail?.panelId === "string"
  );
}
