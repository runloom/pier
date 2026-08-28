import { useEffect } from "react";
import {
  isTerminalOpenSearchEvent,
  isTerminalSearchNavigateEvent,
  TERMINAL_OPEN_SEARCH_EVENT,
  TERMINAL_SEARCH_NAVIGATE_EVENT,
} from "../search-events.ts";

interface UseTerminalSearchOpenArgs {
  onNavigate?: (direction: "next" | "previous") => void;
  onOpen: () => void;
  panelId: string;
  setActive: () => void;
}

export function useTerminalSearchOpen({
  onNavigate,
  onOpen,
  panelId,
  setActive,
}: UseTerminalSearchOpenArgs): void {
  useEffect(() => {
    const openSearch = (event: Event) => {
      if (
        !isTerminalOpenSearchEvent(event) ||
        event.detail.panelId !== panelId
      ) {
        return;
      }
      onOpen();
      setActive();
    };
    const navigateSearch = (event: Event) => {
      if (
        !isTerminalSearchNavigateEvent(event) ||
        event.detail.panelId !== panelId
      ) {
        return;
      }
      onOpen();
      onNavigate?.(event.detail.direction);
      setActive();
    };
    window.addEventListener(TERMINAL_OPEN_SEARCH_EVENT, openSearch);
    window.addEventListener(TERMINAL_SEARCH_NAVIGATE_EVENT, navigateSearch);
    return () => {
      window.removeEventListener(TERMINAL_OPEN_SEARCH_EVENT, openSearch);
      window.removeEventListener(
        TERMINAL_SEARCH_NAVIGATE_EVENT,
        navigateSearch
      );
    };
  }, [onNavigate, onOpen, panelId, setActive]);
}
