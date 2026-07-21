import { useEffect } from "react";
import {
  isTerminalCloseComposerEvent,
  isTerminalOpenComposerEvent,
  TERMINAL_CLOSE_COMPOSER_EVENT,
  TERMINAL_OPEN_COMPOSER_EVENT,
} from "./terminal-composer-events.ts";

interface UseTerminalComposerOpenArgs {
  onClose?: () => void;
  onOpen: () => void;
  panelId: string;
  setActive: () => void;
}

export function useTerminalComposerOpen({
  onClose,
  onOpen,
  panelId,
  setActive,
}: UseTerminalComposerOpenArgs): void {
  useEffect(() => {
    const openComposer = (event: Event) => {
      if (
        !isTerminalOpenComposerEvent(event) ||
        event.detail.panelId !== panelId
      ) {
        return;
      }
      onOpen();
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
    window.addEventListener(TERMINAL_OPEN_COMPOSER_EVENT, openComposer);
    window.addEventListener(TERMINAL_CLOSE_COMPOSER_EVENT, closeComposer);
    return () => {
      window.removeEventListener(TERMINAL_OPEN_COMPOSER_EVENT, openComposer);
      window.removeEventListener(TERMINAL_CLOSE_COMPOSER_EVENT, closeComposer);
    };
  }, [onClose, onOpen, panelId, setActive]);
}
