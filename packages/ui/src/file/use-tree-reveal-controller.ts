import type { useFileTree } from "@pierre/trees/react";
import * as React from "react";
import type { TreeExpansionAuthority } from "./tree-expansion-authority.ts";
import { normalizeExpansionPath } from "./tree-expansion-authority.ts";
import type { FileTreeRefs } from "./tree-internal.ts";
import {
  revealAncestorDirectoryPaths,
  revealFileTreePath,
} from "./tree-reveal.ts";
import { requestRevealAncestorLoads } from "./tree-reveal-ancestor-loads.ts";
import {
  resolveRevealIntentForPath,
  resolveRevealPolicy,
  shouldClearRevealUserAbort,
  shouldHonorUserScrollAbort,
} from "./tree-reveal-policy.ts";
import { REVEAL_RETRY_DELAYS_MS } from "./tree-reveal-timing.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeAutoRevealMode,
  PierFileTreeRevealOptions,
} from "./tree-types.ts";
import { useTreeActiveFileReveal } from "./use-tree-active-file-reveal.ts";
import { useTreeRevealTimers } from "./use-tree-reveal-timers.ts";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

/**
 * Programmatic + active-file reveal: pending retries, ancestor loads when the
 * path is not projected yet, and active-path re-try after items catch up.
 *
 * Gold standard (scroll ownership):
 * - active-file scrolls at most once per path change (first successful projection)
 * - temporary path absence → pending only, no re-nearest scroll
 * - user gesture aborts further scroll (select may still apply)
 */
export function useFileTreeRevealController(options: {
  activeSearchRef: React.MutableRefObject<string | null>;
  autoReveal?: PierFileTreeAutoRevealMode | undefined;
  /** Suppress path-sync layout compensate while a scrolled reveal is pending. */
  beginProgrammaticScroll?: (() => void) | undefined;
  containerRef: React.RefObject<HTMLDivElement | null>;
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined;
  endProgrammaticScroll?: (() => void) | undefined;
  expansionAuthority?: TreeExpansionAuthority | undefined;
  isAutoRevealExcluded?: ((path: string) => boolean) | undefined;
  /** User scroll claim — forces scroll:"none" on reveal attempts. */
  isUserScrolling?: (() => boolean) | undefined;
  model: FileTreeModel;
  programmaticSelectionRef: React.MutableRefObject<{ path: string } | null>;
  readRefs: () => FileTreeRefs;
  renderSignature: string;
  revealPath: string | null | undefined;
  /**
   * Subscribe to sticky user claims (owner). Permanently demotes in-flight
   * reveal scroll until path / request generation changes.
   */
  subscribeUserClaim?: ((listener: () => void) => () => void) | undefined;
}): {
  requestReveal: (path: string, options?: PierFileTreeRevealOptions) => boolean;
  suppressActiveRevealRef: React.MutableRefObject<boolean>;
} {
  const {
    activeSearchRef,
    autoReveal = "on",
    beginProgrammaticScroll,
    containerRef,
    directoryStates,
    endProgrammaticScroll,
    expansionAuthority,
    isAutoRevealExcluded,
    isUserScrolling,
    model,
    programmaticSelectionRef,
    readRefs,
    renderSignature,
    revealPath,
    subscribeUserClaim,
  } = options;

  const programmaticScrollHeldRef = React.useRef(false);
  const holdProgrammaticScroll = React.useCallback(() => {
    if (programmaticScrollHeldRef.current) {
      return;
    }
    programmaticScrollHeldRef.current = true;
    beginProgrammaticScroll?.();
  }, [beginProgrammaticScroll]);
  const releaseProgrammaticScroll = React.useCallback(() => {
    if (!programmaticScrollHeldRef.current) {
      return;
    }
    programmaticScrollHeldRef.current = false;
    endProgrammaticScroll?.();
  }, [endProgrammaticScroll]);

  const pendingRevealRef = React.useRef<{
    options: PierFileTreeRevealOptions;
    path: string;
  } | null>(null);
  // Explicit API/breadcrumb/open-disk reveal wins over active-file until the
  // active path changes to a *different* file.
  const suppressActiveRevealRef = React.useRef(false);
  /** Path that last won an explicit suppress (center / host open). */
  const explicitSuppressPathRef = React.useRef<string | null>(null);
  /**
   * Active-file path that already completed a reveal attempt (scroll or select).
   * Temporary projection gaps must not re-nearest for this path.
   */
  const settledActiveFilePathRef = React.useRef<string | null>(null);
  /**
   * Sticky user abort for in-flight reveal scroll (survives the 150ms claim
   * window). Cleared only when revealPath / request targets a new path.
   */
  const userAbortedScrollRef = React.useRef(false);

  const {
    armPostSuccessScrollHold,
    clearReleaseTimers,
    clearRevealRetryTimers,
    scheduleReleaseAfterIdle,
    scheduleRevealRetry,
  } = useTreeRevealTimers({ pendingRevealRef, releaseProgrammaticScroll });

  const seedRevealExpansionIntent = React.useCallback(
    (path: string, revealOptions?: PierFileTreeRevealOptions) => {
      if (!expansionAuthority || activeSearchRef.current != null) {
        return;
      }
      for (const ancestorPath of revealAncestorDirectoryPaths(path)) {
        expansionAuthority.setDirectoryExpanded(ancestorPath, true, "reveal");
      }
      if (revealOptions?.expandTarget !== false) {
        const item = readRefs().itemsByPath.get(path);
        if (item?.kind === "directory") {
          expansionAuthority.setDirectoryExpanded(
            normalizeExpansionPath(item.path),
            true,
            "reveal"
          );
        }
      }
    },
    [activeSearchRef, expansionAuthority, readRefs]
  );

  const demotePendingScroll = React.useCallback(() => {
    userAbortedScrollRef.current = true;
    const pending = pendingRevealRef.current;
    if (pending && pending.options.scroll !== "none") {
      pendingRevealRef.current = {
        ...pending,
        options: { ...pending.options, scroll: "none" },
      };
    }
    clearReleaseTimers();
    releaseProgrammaticScroll();
  }, [clearReleaseTimers, releaseProgrammaticScroll]);

  React.useEffect(() => {
    if (!subscribeUserClaim) {
      return;
    }
    return subscribeUserClaim(() => {
      demotePendingScroll();
    });
  }, [demotePendingScroll, subscribeUserClaim]);

  const runReveal = React.useCallback(
    (path: string, revealOptions?: PierFileTreeRevealOptions): boolean => {
      seedRevealExpansionIntent(path, revealOptions);
      const honorUserAbort = shouldHonorUserScrollAbort(revealOptions?.intent);
      const scrollSuppressedByUser =
        honorUserAbort &&
        (userAbortedScrollRef.current ||
          (isUserScrolling?.() === true && revealOptions?.scroll !== "none"));
      if (scrollSuppressedByUser && !userAbortedScrollRef.current) {
        // First contact with claim window — stick for remaining retries.
        userAbortedScrollRef.current = true;
      }
      const effectiveOptions: PierFileTreeRevealOptions | undefined =
        honorUserAbort &&
        (scrollSuppressedByUser || userAbortedScrollRef.current)
          ? { ...revealOptions, scroll: "none" }
          : revealOptions;
      return revealFileTreePath(
        {
          focusNearestPath: (candidate) => model.focusNearestPath(candidate),
          focusPath: (candidate) => {
            model.focusPath(candidate);
          },
          getFileTreeContainer: () =>
            containerRef.current?.querySelector("file-tree-container") ??
            undefined,
          getItem: (candidate) => model.getItem(candidate),
          getSelectedPaths: () => model.getSelectedPaths(),
          scrollToPath: (candidate, scrollOptions) => {
            model.scrollToPath(candidate, scrollOptions);
          },
          selectOnlyPath: (candidate) => {
            model.selectOnlyPath(candidate);
          },
        },
        readRefs,
        programmaticSelectionRef,
        path,
        effectiveOptions
      );
    },
    [
      containerRef,
      isUserScrolling,
      model,
      programmaticSelectionRef,
      readRefs,
      seedRevealExpansionIntent,
    ]
  );

  const loadRevealAncestors = React.useCallback(
    (path: string) => {
      requestRevealAncestorLoads(path, readRefs);
    },
    [readRefs]
  );

  const revealRetryGenerationRef = React.useRef(0);

  const markRevealSuccess = React.useCallback(
    (
      path: string,
      scroll: PierFileTreeRevealOptions["scroll"] | undefined,
      intent: PierFileTreeRevealOptions["intent"] | undefined
    ) => {
      pendingRevealRef.current = null;
      revealRetryGenerationRef.current += 1;
      if (intent === "active-file" || intent == null) {
        // Settle even for select-only so temporary gaps do not re-nearest.
        settledActiveFilePathRef.current = path;
      }
      if (scroll === "none") {
        clearReleaseTimers();
        releaseProgrammaticScroll();
      } else {
        armPostSuccessScrollHold();
      }
    },
    [armPostSuccessScrollHold, clearReleaseTimers, releaseProgrammaticScroll]
  );

  const requestReveal = React.useCallback(
    (path: string, revealOptions?: PierFileTreeRevealOptions): boolean => {
      const intent = resolveRevealIntentForPath(path, revealOptions?.intent);
      const pathExcluded =
        intent === "active-file" && isAutoRevealExcluded?.(path) === true;
      const policy = resolveRevealPolicy({
        autoReveal,
        intent,
        pathExcluded,
        overrides: {
          ...(revealOptions?.expandTarget === undefined
            ? {}
            : { expandTarget: revealOptions.expandTarget }),
          ...(revealOptions?.scroll === undefined
            ? {}
            : { scroll: revealOptions.scroll }),
        },
      });

      // User-initiated reveal always clears abort. Active-file only clears
      // when the target path changes (same file must not re-fight the user).
      if (
        shouldClearRevealUserAbort({
          intent,
          path,
          pendingPath: pendingRevealRef.current?.path,
          settledActiveFilePath: settledActiveFilePathRef.current,
        })
      ) {
        userAbortedScrollRef.current = false;
      }

      if (!policy.shouldReveal) {
        const pending = pendingRevealRef.current;
        if (
          pending &&
          pending.path === path &&
          (pending.options.intent === "active-file" ||
            pending.options.intent == null)
        ) {
          pendingRevealRef.current = null;
          revealRetryGenerationRef.current += 1;
          if (pending.options.scroll !== "none") {
            clearReleaseTimers();
            releaseProgrammaticScroll();
          }
        }
        return true;
      }

      if (policy.suppressActive) {
        suppressActiveRevealRef.current = true;
        explicitSuppressPathRef.current = path;
      }

      let scroll = policy.scroll;
      // Already settled this active-file path: never re-scroll on churn.
      if (
        intent === "active-file" &&
        settledActiveFilePathRef.current === path &&
        scroll !== "none"
      ) {
        scroll = "none";
      }
      if (userAbortedScrollRef.current) {
        scroll = "none";
      }

      const nextOptions: PierFileTreeRevealOptions = {
        expandTarget: policy.expandTarget,
        intent,
        ...(revealOptions?.preserveFocus === undefined
          ? {}
          : { preserveFocus: revealOptions.preserveFocus }),
        scroll,
      };

      if (nextOptions.scroll === "none") {
        if (
          pendingRevealRef.current == null ||
          pendingRevealRef.current.path === path
        ) {
          clearReleaseTimers();
          releaseProgrammaticScroll();
        }
      } else {
        holdProgrammaticScroll();
      }

      seedRevealExpansionIntent(path, nextOptions);
      pendingRevealRef.current = {
        options: nextOptions,
        path,
      };

      if (runReveal(path, nextOptions)) {
        markRevealSuccess(path, nextOptions.scroll, intent);
        return true;
      }

      loadRevealAncestors(path);
      revealRetryGenerationRef.current += 1;
      const generation = revealRetryGenerationRef.current;
      clearRevealRetryTimers();
      for (const delayMs of REVEAL_RETRY_DELAYS_MS) {
        scheduleRevealRetry(delayMs, () => {
          if (generation !== revealRetryGenerationRef.current) {
            return;
          }
          const pending = pendingRevealRef.current;
          if (!pending || pending.path !== path) {
            return;
          }
          if (runReveal(pending.path, pending.options)) {
            markRevealSuccess(
              pending.path,
              pending.options.scroll,
              pending.options.intent
            );
            return;
          }
          loadRevealAncestors(pending.path);
          seedRevealExpansionIntent(pending.path, pending.options);
          if (delayMs === REVEAL_RETRY_DELAYS_MS.at(-1)) {
            pendingRevealRef.current = null;
            clearReleaseTimers();
            releaseProgrammaticScroll();
          }
        });
      }
      return false;
    },
    [
      autoReveal,
      clearReleaseTimers,
      clearRevealRetryTimers,
      holdProgrammaticScroll,
      isAutoRevealExcluded,
      loadRevealAncestors,
      markRevealSuccess,
      releaseProgrammaticScroll,
      runReveal,
      scheduleRevealRetry,
      seedRevealExpansionIntent,
    ]
  );

  // Lazy directories: retry after items / directoryStates catch up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: directoryStates / model / renderSignature intentionally retrigger pending reveal after lazy loads sync into the tree.
  React.useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) {
      if (programmaticScrollHeldRef.current) {
        scheduleReleaseAfterIdle();
      }
      return;
    }
    if (runReveal(pending.path, pending.options)) {
      markRevealSuccess(
        pending.path,
        pending.options.scroll,
        pending.options.intent
      );
      return;
    }
    loadRevealAncestors(pending.path);
  }, [
    directoryStates,
    loadRevealAncestors,
    markRevealSuccess,
    model,
    renderSignature,
    runReveal,
    scheduleReleaseAfterIdle,
  ]);

  useTreeActiveFileReveal({
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
  });

  React.useEffect(
    () => () => {
      clearReleaseTimers();
      releaseProgrammaticScroll();
    },
    [clearReleaseTimers, releaseProgrammaticScroll]
  );

  return { requestReveal, suppressActiveRevealRef };
}
