import { useEffect } from "react";
import {
  isTerminalOpenSearchEvent,
  TERMINAL_OPEN_SEARCH_EVENT,
} from "./terminal-search-events.ts";

interface UseTerminalSearchOpenArgs {
  onOpen: () => void;
  panelId: string;
  setActive: () => void;
}

export function useTerminalSearchOpen({
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
      setActive();
      onOpen();
    };
    window.addEventListener(TERMINAL_OPEN_SEARCH_EVENT, openSearch);
    return () => {
      window.removeEventListener(TERMINAL_OPEN_SEARCH_EVENT, openSearch);
    };
  }, [onOpen, panelId, setActive]);
}
