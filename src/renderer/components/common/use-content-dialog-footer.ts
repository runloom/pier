import { type ReactNode, useLayoutEffect } from "react";

/** Stable no-op when a page-mode detail has no content-dialog footer slot. */
export function noopContentDialogSetFooter(_footer: ReactNode | null): void {}

/**
 * Register sticky DialogFooter actions with {@link AppContentDialogHost}.
 * Pass a memoized node (or rebuild when action deps change).
 */
export function useContentDialogFooter(
  setFooter: (footer: ReactNode | null) => void,
  footer: ReactNode | null
): void {
  useLayoutEffect(() => {
    setFooter(footer);
    return () => {
      setFooter(null);
    };
  }, [setFooter, footer]);
}
