export const TERMINAL_OPEN_SEARCH_EVENT = "pier:terminal:open-search";
export const TERMINAL_SEARCH_NAVIGATE_EVENT = "pier:terminal:search-navigate";

export interface TerminalOpenSearchEventDetail {
  panelId: string;
}

export interface TerminalSearchNavigateEventDetail {
  direction: "next" | "previous";
  panelId: string;
}

export function dispatchTerminalOpenSearch(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent<TerminalOpenSearchEventDetail>(TERMINAL_OPEN_SEARCH_EVENT, {
      detail: { panelId },
    })
  );
}

export function dispatchTerminalSearchNavigate(
  panelId: string,
  direction: "next" | "previous"
): void {
  window.dispatchEvent(
    new CustomEvent<TerminalSearchNavigateEventDetail>(
      TERMINAL_SEARCH_NAVIGATE_EVENT,
      {
        detail: { direction, panelId },
      }
    )
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

export function isTerminalSearchNavigateEvent(
  event: Event
): event is CustomEvent<TerminalSearchNavigateEventDetail> {
  return (
    event.type === TERMINAL_SEARCH_NAVIGATE_EVENT &&
    event instanceof CustomEvent &&
    typeof event.detail?.panelId === "string" &&
    (event.detail.direction === "next" || event.detail.direction === "previous")
  );
}
