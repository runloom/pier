import type { useFileTree } from "@pierre/trees/react";
import * as React from "react";
import type { TreeExpansionAuthority } from "./tree-expansion-authority.ts";
import { normalizeExpansionPath } from "./tree-expansion-authority.ts";
import type { FileTreeRefs } from "./tree-internal.ts";
import {
  revealAncestorDirectoryPaths,
  revealFileTreePath,
} from "./tree-reveal.ts";
import {
  resolveRevealIntentForPath,
  resolveRevealPolicy,
} from "./tree-reveal-policy.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeAutoRevealMode,
  PierFileTreeRevealOptions,
} from "./tree-types.ts";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

/** Cold first-open deep paths need several listing + layout passes. */
const REVEAL_RETRY_DELAYS_MS = [0, 32, 80, 160, 320, 640, 1200, 2000, 3200];
/**
 * After a successful scrolled reveal, keep path-sync restore suppressed until
 * render/list churn settles. Resets on each renderSignature while idle.
 */
const POST_SUCCESS_IDLE_RELEASE_MS = 400;
/** Hard cap so suppress cannot leak if idle never settles. */
const POST_SUCCESS_MAX_HOLD_MS = 2500;

/**
 * Programmatic + active-file reveal: pending retries, ancestor loads when the
 * path is not projected yet, and active-path re-try after items catch up.
 *
 * Default scroll/expand flags come from `resolveRevealPolicy` (single owner).
 */
export function useFileTreeRevealController(options: {
  activeSearchRef: React.MutableRefObject<string | null>;
  autoReveal?: PierFileTreeAutoRevealMode | undefined;
  /** Suppress path-sync scroll restore while a scrolled reveal is pending. */
  beginProgrammaticScroll?: (() => void) | undefined;
  containerRef: React.RefObject<HTMLDivElement | null>;
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined;
  endProgrammaticScroll?: (() => void) | undefined;
  expansionAuthority?: TreeExpansionAuthority | undefined;
  isAutoRevealExcluded?: ((path: string) => boolean) | undefined;
  model: FileTreeModel;
  programmaticSelectionRef: React.MutableRefObject<{ path: string } | null>;
  readRefs: () => FileTreeRefs;
  renderSignature: string;
  revealPath: string | null | undefined;
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
    model,
    programmaticSelectionRef,
    readRefs,
    renderSignature,
    revealPath,
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

  const releaseIdleTimerRef = React.useRef<number | null>(null);
  const releaseHardTimerRef = React.useRef<number | null>(null);

  const clearReleaseTimers = React.useCallback(() => {
    if (releaseIdleTimerRef.current != null) {
      window.clearTimeout(releaseIdleTimerRef.current);
      releaseIdleTimerRef.current = null;
    }
    if (releaseHardTimerRef.current != null) {
      window.clearTimeout(releaseHardTimerRef.current);
      releaseHardTimerRef.current = null;
    }
  }, []);

  const scheduleReleaseAfterIdle = React.useCallback(() => {
    if (releaseIdleTimerRef.current != null) {
      window.clearTimeout(releaseIdleTimerRef.current);
    }
    releaseIdleTimerRef.current = window.setTimeout(() => {
      releaseIdleTimerRef.current = null;
      if (pendingRevealRef.current === null) {
        clearReleaseTimers();
        releaseProgrammaticScroll();
      }
    }, POST_SUCCESS_IDLE_RELEASE_MS);
  }, [clearReleaseTimers, releaseProgrammaticScroll]);

  const armPostSuccessScrollHold = React.useCallback(() => {
    clearReleaseTimers();
    // Idle release: resets whenever renderSignature keeps churning (effect below).
    scheduleReleaseAfterIdle();
    // Hard cap.
    releaseHardTimerRef.current = window.setTimeout(() => {
      releaseHardTimerRef.current = null;
      if (pendingRevealRef.current === null) {
        clearReleaseTimers();
        releaseProgrammaticScroll();
      }
    }, POST_SUCCESS_MAX_HOLD_MS);
  }, [clearReleaseTimers, releaseProgrammaticScroll, scheduleReleaseAfterIdle]);

  /**
   * Persist expand intents before/regardless of model success so lazy list +
   * expand-collapse effects open the parent chain on cold first open.
   */
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

  const runReveal = React.useCallback(
    (path: string, revealOptions?: PierFileTreeRevealOptions): boolean => {
      seedRevealExpansionIntent(path, revealOptions);
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
        revealOptions
      );
    },
    [
      containerRef,
      model,
      programmaticSelectionRef,
      readRefs,
      seedRevealExpansionIntent,
    ]
  );

  /**
   * When reveal targets a path not yet projected, list missing ancestors via
   * onLoadDirectory so pending retries (and the items-sync effect) can finish.
   */
  const requestRevealAncestorLoads = React.useCallback(
    (path: string) => {
      if (path.length === 0) {
        return;
      }
      const onLoadDirectory = readRefs().onLoadDirectory;
      if (!onLoadDirectory) {
        return;
      }
      const itemsByPath = readRefs().itemsByPath;
      const segments = path.split("/").filter(Boolean);
      for (let index = 1; index < segments.length; index += 1) {
        const ancestorPath = segments.slice(0, index).join("/");
        const ancestorItem = itemsByPath.get(ancestorPath);
        if (ancestorItem?.kind !== "directory") {
          // Parent of a missing segment must be listed first.
          if (index > 1) {
            const parentPath = segments.slice(0, index - 1).join("/");
            if (itemsByPath.get(parentPath)?.kind === "directory") {
              Promise.resolve(onLoadDirectory(parentPath)).catch(
                () => undefined
              );
            }
          } else if (!ancestorItem) {
            // Root-level directory missing from projection: list root "" if supported.
            Promise.resolve(onLoadDirectory("")).catch(() => undefined);
          }
          break;
        }
        const prefix = `${ancestorPath}/`;
        let hasChild = false;
        for (const item of itemsByPath.values()) {
          if (item.path.startsWith(prefix) && item.path !== ancestorPath) {
            hasChild = true;
            break;
          }
        }
        if (!hasChild) {
          Promise.resolve(onLoadDirectory(ancestorPath)).catch(() => undefined);
        }
      }
    },
    [readRefs]
  );

  const revealRetryGenerationRef = React.useRef(0);

  const markRevealSuccess = React.useCallback(
    (scroll: PierFileTreeRevealOptions["scroll"] | undefined) => {
      pendingRevealRef.current = null;
      revealRetryGenerationRef.current += 1;
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

      if (!policy.shouldReveal) {
        // Skip only our own active-file pending for this path. Never tear down
        // a concurrent explicit/search/root reveal or release its scroll hold.
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
            // This pending owned the hold — release only if nothing else pending.
            // (We just cleared the only pending.)
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

      const nextOptions: PierFileTreeRevealOptions = {
        expandTarget: policy.expandTarget,
        intent,
        scroll: policy.scroll,
      };

      // While scrolled reveal is pending, block path-sync scroll restore.
      if (policy.scroll === "none") {
        // Select-only: do not hold restore suppress for scroll.
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
        markRevealSuccess(policy.scroll);
        return true;
      }

      requestRevealAncestorLoads(path);
      revealRetryGenerationRef.current += 1;
      const generation = revealRetryGenerationRef.current;
      for (const delayMs of REVEAL_RETRY_DELAYS_MS) {
        window.setTimeout(() => {
          if (generation !== revealRetryGenerationRef.current) {
            return;
          }
          const pending = pendingRevealRef.current;
          if (!pending || pending.path !== path) {
            return;
          }
          if (runReveal(pending.path, pending.options)) {
            markRevealSuccess(pending.options.scroll);
            return;
          }
          requestRevealAncestorLoads(pending.path);
          seedRevealExpansionIntent(pending.path, pending.options);
          if (delayMs === REVEAL_RETRY_DELAYS_MS.at(-1)) {
            pendingRevealRef.current = null;
            clearReleaseTimers();
            releaseProgrammaticScroll();
          }
        }, delayMs);
      }
      return false;
    },
    [
      autoReveal,
      clearReleaseTimers,
      holdProgrammaticScroll,
      isAutoRevealExcluded,
      markRevealSuccess,
      releaseProgrammaticScroll,
      requestRevealAncestorLoads,
      runReveal,
      seedRevealExpansionIntent,
    ]
  );

  // Lazy directories: retry after items / directoryStates catch up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: directoryStates / model / renderSignature intentionally retrigger pending reveal after lazy loads sync into the tree.
  React.useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) {
      // No pending: if we are still holding after success, reset idle timer on churn.
      if (programmaticScrollHeldRef.current) {
        scheduleReleaseAfterIdle();
      }
      return;
    }
    if (runReveal(pending.path, pending.options)) {
      markRevealSuccess(pending.options.scroll);
      return;
    }
    requestRevealAncestorLoads(pending.path);
  }, [
    directoryStates,
    markRevealSuccess,
    model,
    renderSignature,
    requestRevealAncestorLoads,
    runReveal,
    scheduleReleaseAfterIdle,
  ]);

  // Active file: select+focus+scroll per policy; expand ancestors only (not the
  // folder itself). Explicit/host open suppress demotion until active path
  // changes to a different file.
  const lastRevealRef = React.useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSignature re-triggers when items/load projection catches up for the same path.
  React.useEffect(() => {
    if (!revealPath) {
      lastRevealRef.current = null;
      suppressActiveRevealRef.current = false;
      explicitSuppressPathRef.current = null;
      return;
    }
    if (revealPath !== lastRevealRef.current) {
      lastRevealRef.current = revealPath;
      // Host/explicit open for this path: keep suppress, do not demote to nearest.
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
    if (!item) {
      requestReveal(revealPath, {
        expandTarget: false,
        intent: "active-file",
      });
    }
  }, [
    autoReveal,
    isAutoRevealExcluded,
    readRefs,
    requestReveal,
    revealPath,
    renderSignature,
  ]);

  React.useEffect(
    () => () => {
      clearReleaseTimers();
      releaseProgrammaticScroll();
    },
    [clearReleaseTimers, releaseProgrammaticScroll]
  );

  return { requestReveal, suppressActiveRevealRef };
}
