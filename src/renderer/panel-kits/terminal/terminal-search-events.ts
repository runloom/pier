export const TERMINAL_OPEN_SEARCH_EVENT = "pier:terminal:open-search";

export interface TerminalOpenSearchEventDetail {
  panelId: string;
}

export function dispatchTerminalOpenSearch(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent<TerminalOpenSearchEventDetail>(TERMINAL_OPEN_SEARCH_EVENT, {
      detail: { panelId },
    })
  );
}

export function isTerminalOpenSearchEvent(
  event: Event
): event is CustomEvent<TerminalOpenSearchEventDetail> {
  return (
    event.type === TERMINAL_OPEN_SEARCH_EVENT &&
    event instanceof CustomEvent &&
    typeof event.detail?.panelId === "string"
  );
}
