import { useCallback, useEffect, useRef } from "react";
import { registerWebFocusScope } from "@/stores/terminal-input-routing.store.ts";

export function useTerminalSearchKeyboardOpening(panelId: string): {
  holdOpeningKeyboardFocus: () => void;
  releaseOpeningKeyboardFocus: () => void;
} {
  const releaseRef = useRef<(() => void) | null>(null);

  const holdOpeningKeyboardFocus = useCallback(() => {
    if (releaseRef.current) {
      return;
    }
    releaseRef.current = registerWebFocusScope(
      `terminal-search:${panelId}:opening`,
      "transient"
    );
  }, [panelId]);

  const releaseOpeningKeyboardFocus = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  useEffect(
    () => () => {
      releaseOpeningKeyboardFocus();
    },
    [releaseOpeningKeyboardFocus]
  );

  return { holdOpeningKeyboardFocus, releaseOpeningKeyboardFocus };
}
