import { useEffect } from "react";
import {
  isTerminalCloseComposerEvent,
  isTerminalComposerAttachEvent,
  isTerminalOpenComposerEvent,
  TERMINAL_CLOSE_COMPOSER_EVENT,
  TERMINAL_COMPOSER_ATTACH_EVENT,
  TERMINAL_OPEN_COMPOSER_EVENT,
} from "./terminal-composer-events.ts";

interface UseTerminalComposerOpenArgs {
  /** Ensure open, then bump attach request (shortcut / command). */
  onAttach: () => void;
  onClose?: () => void;
  /** Open when closed; close when open (shortcut / menu / command palette). */
  onToggle: () => void;
  panelId: string;
  setActive: () => void;
}

export function useTerminalComposerOpen({
  onAttach,
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
    const attachComposer = (event: Event) => {
      if (
        !isTerminalComposerAttachEvent(event) ||
        event.detail.panelId !== panelId
      ) {
        return;
      }
      onAttach();
      setActive();
    };
    window.addEventListener(TERMINAL_OPEN_COMPOSER_EVENT, toggleComposer);
    window.addEventListener(TERMINAL_CLOSE_COMPOSER_EVENT, closeComposer);
    window.addEventListener(TERMINAL_COMPOSER_ATTACH_EVENT, attachComposer);
    return () => {
      window.removeEventListener(TERMINAL_OPEN_COMPOSER_EVENT, toggleComposer);
      window.removeEventListener(TERMINAL_CLOSE_COMPOSER_EVENT, closeComposer);
      window.removeEventListener(
        TERMINAL_COMPOSER_ATTACH_EVENT,
        attachComposer
      );
    };
  }, [onAttach, onClose, onToggle, panelId, setActive]);
}
