import { createContext, useCallback, useContext, useId, useRef } from "react";

export interface TerminalOverlayRegistry {
  registerElement(id: string, el: HTMLElement): { dispose(): void };
  requestFocus(id: string): () => void;
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional noop
function noop() {}

const noopRegistry: TerminalOverlayRegistry = {
  registerElement: () => ({ dispose: noop }),
  requestFocus: () => noop,
};

export const TerminalOverlayContext =
  createContext<TerminalOverlayRegistry>(noopRegistry);

export function useTerminalOverlay({
  focus,
}: {
  focus: boolean;
}): (el: HTMLElement | null) => void {
  const registry = useContext(TerminalOverlayContext);
  const id = useId();
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (!el) {
        return;
      }
      const overlayId = `terminal-overlay:${id}`;
      const registration = registry.registerElement(overlayId, el);
      const releaseFocus = focus ? registry.requestFocus(overlayId) : null;
      cleanupRef.current = () => {
        registration.dispose();
        releaseFocus?.();
      };
    },
    [id, focus, registry]
  );
}
