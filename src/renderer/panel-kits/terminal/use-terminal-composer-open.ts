import { useEffect } from "react";
import {
  isTerminalCloseComposerEvent,
  isTerminalOpenComposerEvent,
  TERMINAL_CLOSE_COMPOSER_EVENT,
  TERMINAL_OPEN_COMPOSER_EVENT,
} from "./terminal-composer-events.ts";

interface UseTerminalComposerOpenArgs {
  onClose?: () => void;
  /** Open when closed; close when open (shortcut / menu / command palette). */
  onToggle: () => void;
  panelId: string;
  setActive: () => void;
}

export function useTerminalComposerOpen({
  onClose,
  onToggle,
  panelId,
  setActive,
}: UseTerminalComposerOpenArgs): void {
  useEffect(() => {
    const toggleComposer = (event: Event) => {
      if (
        !isTerminalOpenComposerEvent(event) ||
        event.detail.panelId !== panelId
      ) {
        return;
      }
      onToggle();
      setActive();
    };
    const closeComposer = (event: Event) => {
      if (
        !isTerminalCloseComposerEvent(event) ||
        event.detail.panelId !== panelId
      ) {
        return;
      }
      onClose?.();
    };
    window.addEventListener(TERMINAL_OPEN_COMPOSER_EVENT, toggleComposer);
    window.addEventListener(TERMINAL_CLOSE_COMPOSER_EVENT, closeComposer);
    return () => {
      window.removeEventListener(TERMINAL_OPEN_COMPOSER_EVENT, toggleComposer);
      window.removeEventListener(TERMINAL_CLOSE_COMPOSER_EVENT, closeComposer);
    };
  }, [onClose, onToggle, panelId, setActive]);
}
