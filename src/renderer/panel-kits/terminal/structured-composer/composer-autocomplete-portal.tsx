import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders autocomplete above the composer input via a body portal.
 * Compact chrome uses `overflow-hidden` on the editor shell; in-tree
 * `absolute bottom-full` menus are clipped and look like "@ does nothing".
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
        bottom: Math.max(0, window.innerHeight - rect.top + 4),
        left: rect.left,
        width: rect.width,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
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
