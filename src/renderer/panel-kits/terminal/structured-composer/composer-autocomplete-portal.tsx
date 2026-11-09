import { useTerminalOverlayRegistration } from "@pier/ui/use-terminal-overlay.tsx";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { COMPOSER_SUGGEST_GAP_PX } from "./composer-suggest-layout.ts";

/**
 * Renders autocomplete above the composer via a body portal.
 *
 * Width always equals the anchor’s client width (Codex: list is w-full of the
 * composer chrome). Prefer anchoring to the full Rich Input card
 * (`data-testid="terminal-composer"`), not only the contenteditable.
 *
 * 列表从 composer 向上展开，会压在终端 viewport 上；必须登记为 web 浮层，
 * 否则 native 洞遮罩会把整块列表硬裁掉（composer 自身只登记了卡片区域）。
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
  const { flush: flushOverlay, ref: overlayRef } =
    useTerminalOverlayRegistration();

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

  // 几何来自 fixed 定位；位置只在 style 变化时更新，ResizeObserver 可能不触发，
  // 因此每次 box 变化后主动刷新已登记矩形。
  useLayoutEffect(() => {
    if (box) {
      flushOverlay();
    }
  }, [box, flushOverlay]);

  if (!(box && children)) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-auto fixed z-50"
      data-testid="terminal-composer-autocomplete-portal"
      ref={overlayRef}
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
