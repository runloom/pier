export const TERMINAL_OPEN_COMPOSER_EVENT = "pier:terminal:open-composer";
export const TERMINAL_CLOSE_COMPOSER_EVENT = "pier:terminal:close-composer";

export interface TerminalComposerEventDetail {
  panelId: string;
}

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
