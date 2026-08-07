import { useReactFlow } from "@xyflow/react";
import { type RefObject, useEffect } from "react";
import { FIT_VIEW_OPTIONS } from "./node-graph-model.ts";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Fit after the surface has non-zero layout size (expand portal is often 0 on first frame). */
export function FitViewOnViewportChange({
  containerRef,
  token,
}: {
  containerRef: RefObject<HTMLElement | null>;
  token: string;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    let cancelled = false;
    let fitted = false;
    let ro: ResizeObserver | null = null;
    let outerFrame = 0;
    let innerFrame = 0;

    const attempt = () => {
      if (cancelled || fitted) {
        return;
      }
      const el = containerRef.current;
      if (!el) {
        return;
      }
      const { width, height } = el.getBoundingClientRect();
      if (width < 8 || height < 8) {
        return;
      }
      fitted = true;
      fitView(FIT_VIEW_OPTIONS).catch(() => undefined);
      ro?.disconnect();
      ro = null;
    };

    // layoutToken is in the dependency list so expand/inline re-fits after size changes.
    const layoutToken = token;

    outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (layoutToken.length === 0) {
          return;
        }
        attempt();
      });
    });

    const el = containerRef.current;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => attempt());
      ro.observe(el);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
      ro?.disconnect();
    };
  }, [containerRef, fitView, token]);
  return null;
}

export function listFocusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (el) => {
      if (el.getAttribute("aria-hidden") === "true") {
        return false;
      }
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    }
  );
}

/**
 * Body scroll lock, initial close focus, Tab trap, Escape dismiss, focus restore.
 * Only while expanded with content.
 */
export function useNodeGraphExpandedChrome({
  dialogRef,
  restoreFocusRef,
  showExpanded,
  setExpanded,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  restoreFocusRef: RefObject<HTMLElement | null>;
  setExpanded: (value: boolean) => void;
  showExpanded: boolean;
}): void {
  useEffect(() => {
    if (!showExpanded) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!(restoreFocusRef.current instanceof HTMLElement)) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }

    const focusClose = () => {
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-node-graph-close]")
        ?.focus();
    };
    let outerFrame = 0;
    let innerFrame = 0;
    outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(focusClose);
    });
    const focusTimer = window.setTimeout(focusClose, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      if (event.key === "Escape") {
        const modals = document.querySelectorAll<HTMLElement>(
          '[aria-modal="true"]'
        );
        const topModal = modals.item(modals.length - 1);
        if (topModal && topModal !== dialog) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = listFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!(first && last)) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restore && document.contains(restore)) {
        restore.focus();
      }
    };
  }, [dialogRef, restoreFocusRef, setExpanded, showExpanded]);
}
