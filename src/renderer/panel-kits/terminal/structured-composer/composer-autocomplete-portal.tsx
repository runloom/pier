import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { COMPOSER_SUGGEST_GAP_PX } from "./composer-suggest-layout.ts";

/**
 * Renders autocomplete above the composer via a body portal.
 *
 * Width always equals the anchor’s client width (Codex: list is w-full of the
 * composer chrome). Prefer anchoring to the full Rich Input card
 * (`data-testid="terminal-composer"`), not only the contenteditable.
 */
export function ComposerAutocompletePortal({
  anchor,
  children,
}: {
  anchor: HTMLElement | null;
  children: ReactNode;
}): ReactNode {
  const [box, setBox] = useState<{
    bottom: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setBox(null);
      return;
    }
    const update = (): void => {
      const rect = anchor.getBoundingClientRect();
      setBox({
        bottom: Math.max(
          0,
          window.innerHeight - rect.top + COMPOSER_SUGGEST_GAP_PX
        ),
        left: rect.left,
        // Match chrome width exactly — no independent maxWidth.
        width: rect.width,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(anchor);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      ro?.disconnect();
    };
  }, [anchor]);

  if (!(box && children)) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-auto fixed z-50"
      data-testid="terminal-composer-autocomplete-portal"
      style={{
        bottom: box.bottom,
        left: box.left,
        width: box.width,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
