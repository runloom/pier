import * as React from "react";
import type { FileTreeRefs } from "./tree-internal.ts";
import { resolveRevealPolicy } from "./tree-reveal-policy.ts";
import type {
  PierFileTreeAutoRevealMode,
  PierFileTreeRevealOptions,
} from "./tree-types.ts";

interface ActiveFileRevealInput {
  autoReveal: PierFileTreeAutoRevealMode;
  explicitSuppressPathRef: React.MutableRefObject<string | null>;
  holdProgrammaticScroll: () => void;
  isAutoRevealExcluded?: ((path: string) => boolean) | undefined;
  loadRevealAncestors: (path: string) => void;
  pendingRevealRef: React.MutableRefObject<{
    options: PierFileTreeRevealOptions;
    path: string;
  } | null>;
  readRefs: () => FileTreeRefs;
  renderSignature: string;
  requestReveal: (path: string, options?: PierFileTreeRevealOptions) => boolean;
  revealPath: string | null | undefined;
  seedRevealExpansionIntent: (
    path: string,
    options?: PierFileTreeRevealOptions
  ) => void;
  settledActiveFilePathRef: React.MutableRefObject<string | null>;
  suppressActiveRevealRef: React.MutableRefObject<boolean>;
  userAbortedScrollRef: React.MutableRefObject<boolean>;
}

/**
 * Active-file prop tracking: path change → requestReveal once; temporary
 * projection gaps hang pending without re-nearest.
 */
export function useTreeActiveFileReveal(input: ActiveFileRevealInput): void {
  const {
    autoReveal,
    explicitSuppressPathRef,
    holdProgrammaticScroll,
    isAutoRevealExcluded,
    loadRevealAncestors,
    pendingRevealRef,
    readRefs,
    renderSignature,
    requestReveal,
    revealPath,
    seedRevealExpansionIntent,
    settledActiveFilePathRef,
    suppressActiveRevealRef,
    userAbortedScrollRef,
  } = input;

  const lastRevealRef = React.useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSignature re-triggers when items/load projection catches up for the same path.
  React.useEffect(() => {
    if (!revealPath) {
      lastRevealRef.current = null;
      settledActiveFilePathRef.current = null;
      userAbortedScrollRef.current = false;
      suppressActiveRevealRef.current = false;
      explicitSuppressPathRef.current = null;
      return;
    }
    if (revealPath !== lastRevealRef.current) {
      lastRevealRef.current = revealPath;
      settledActiveFilePathRef.current = null;
      userAbortedScrollRef.current = false;
      if (
        suppressActiveRevealRef.current &&
        (pendingRevealRef.current?.path === revealPath ||
          explicitSuppressPathRef.current === revealPath)
      ) {
        return;
      }
      suppressActiveRevealRef.current = false;
      explicitSuppressPathRef.current = null;
      requestReveal(revealPath, {
        expandTarget: false,
        intent: "active-file",
      });
      return;
    }
    if (suppressActiveRevealRef.current) {
      return;
    }
    if (pendingRevealRef.current?.path === revealPath) {
      return;
    }
    const item = readRefs().itemsByPath.get(revealPath);
    if (item) {
      return;
    }
    // Temporary gap after settle: hang pending only — never requestReveal.
    const pathExcluded = isAutoRevealExcluded?.(revealPath) === true;
    const policy = resolveRevealPolicy({
      autoReveal,
      intent: "active-file",
      pathExcluded,
      overrides: { expandTarget: false },
    });
    if (!policy.shouldReveal) {
      return;
    }
    let scroll =
      settledActiveFilePathRef.current === revealPath ? "none" : policy.scroll;
    if (userAbortedScrollRef.current) {
      scroll = "none";
    }
    pendingRevealRef.current = {
      options: {
        expandTarget: false,
        intent: "active-file",
        scroll,
      },
      path: revealPath,
    };
    if (scroll !== "none") {
      holdProgrammaticScroll();
    }
    seedRevealExpansionIntent(revealPath, {
      expandTarget: false,
      intent: "active-file",
      scroll,
    });
    loadRevealAncestors(revealPath);
  }, [
    autoReveal,
    explicitSuppressPathRef,
    holdProgrammaticScroll,
    isAutoRevealExcluded,
    loadRevealAncestors,
    pendingRevealRef,
    readRefs,
    requestReveal,
    revealPath,
    renderSignature,
    seedRevealExpansionIntent,
    settledActiveFilePathRef,
    suppressActiveRevealRef,
    userAbortedScrollRef,
  ]);
}
