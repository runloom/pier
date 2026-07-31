import type { useFileTree } from "@pierre/trees/react";
import * as React from "react";
import type { TreeExpansionAuthority } from "./tree-expansion-authority.ts";
import { normalizeExpansionPath } from "./tree-expansion-authority.ts";
import type { FileTreeRefs } from "./tree-internal.ts";
import { revealFileTreePath } from "./tree-reveal.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeRevealOptions,
} from "./tree-types.ts";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

/**
 * Programmatic + active-file reveal: pending retries, ancestor loads when the
 * path is not projected yet, and active-path re-try after items catch up.
 */
export function useFileTreeRevealController(options: {
  activeSearchRef: React.MutableRefObject<string | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined;
  expansionAuthority?: TreeExpansionAuthority | undefined;
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
    containerRef,
    directoryStates,
    expansionAuthority,
    model,
    programmaticSelectionRef,
    readRefs,
    renderSignature,
    revealPath,
  } = options;

  const pendingRevealRef = React.useRef<{
    options: PierFileTreeRevealOptions;
    path: string;
  } | null>(null);
  // Explicit API/breadcrumb reveal must win over the active-file prop until the
  // active path itself changes (otherwise expand/load churn re-asserts the file).
  const suppressActiveRevealRef = React.useRef(false);

  const runReveal = React.useCallback(
    (path: string, revealOptions?: PierFileTreeRevealOptions): boolean => {
      const ok = revealFileTreePath(
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
      if (ok && expansionAuthority && activeSearchRef.current == null) {
        const segments = path.split("/").filter(Boolean);
        for (let index = 1; index < segments.length; index += 1) {
          expansionAuthority.setDirectoryExpanded(
            segments.slice(0, index).join("/"),
            true,
            "reveal"
          );
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
      }
      return ok;
    },
    [
      activeSearchRef,
      containerRef,
      expansionAuthority,
      model,
      programmaticSelectionRef,
      readRefs,
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

  const requestReveal = React.useCallback(
    (path: string, revealOptions?: PierFileTreeRevealOptions): boolean => {
      const nextOptions: PierFileTreeRevealOptions = {
        expandTarget: true,
        scroll: "center",
        ...revealOptions,
      };
      pendingRevealRef.current = {
        options: nextOptions,
        path,
      };
      if (runReveal(path, nextOptions)) {
        pendingRevealRef.current = null;
        // Cancel any prior timer batch for a different path.
        revealRetryGenerationRef.current += 1;
        return true;
      }
      // Path not selectable yet — pull missing ancestor listings, then retry.
      requestRevealAncestorLoads(path);
      // Expand/lazy-load can leave the row unselectable for a frame or two.
      // One generation per requestReveal call so rapid path changes cancel old timers.
      revealRetryGenerationRef.current += 1;
      const generation = revealRetryGenerationRef.current;
      const retryDelaysMs = [0, 32, 80, 160, 320, 640, 1200];
      for (const delayMs of retryDelaysMs) {
        window.setTimeout(() => {
          if (generation !== revealRetryGenerationRef.current) {
            return;
          }
          const pending = pendingRevealRef.current;
          if (!pending || pending.path !== path) {
            return;
          }
          if (runReveal(pending.path, pending.options)) {
            pendingRevealRef.current = null;
            revealRetryGenerationRef.current += 1;
            return;
          }
          // Keep requesting loads on later retries (store may still be cold).
          requestRevealAncestorLoads(pending.path);
        }, delayMs);
      }
      return false;
    },
    [requestRevealAncestorLoads, runReveal]
  );

  // Lazy directories: retry after items / directoryStates catch up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: directoryStates / model / renderSignature intentionally retrigger pending reveal after lazy loads sync into the tree.
  React.useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) {
      return;
    }
    if (runReveal(pending.path, pending.options)) {
      pendingRevealRef.current = null;
      return;
    }
    requestRevealAncestorLoads(pending.path);
  }, [
    directoryStates,
    model,
    renderSignature,
    requestRevealAncestorLoads,
    runReveal,
  ]);

  // Active file: select+focus+scroll nearest; expand ancestors only (not the
  // folder itself). Programmatic select must not fire onOpenPath.
  // Explicit breadcrumb/API reveals suppress this until the active path changes.
  // Same path re-tries when items/model catch up (sidebar remount, lazy list).
  const lastRevealRef = React.useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSignature re-triggers when items/load projection catches up for the same path.
  React.useEffect(() => {
    if (!revealPath) {
      lastRevealRef.current = null;
      suppressActiveRevealRef.current = false;
      return;
    }
    if (revealPath !== lastRevealRef.current) {
      lastRevealRef.current = revealPath;
      suppressActiveRevealRef.current = false;
      requestReveal(revealPath, {
        expandTarget: false,
        scroll: "nearest",
      });
      return;
    }
    if (suppressActiveRevealRef.current) {
      return;
    }
    // Path unchanged but tree was cold last time — keep pending alive.
    if (pendingRevealRef.current?.path === revealPath) {
      return;
    }
    const item = readRefs().itemsByPath.get(revealPath);
    if (!item) {
      requestReveal(revealPath, {
        expandTarget: false,
        scroll: "nearest",
      });
    }
  }, [readRefs, requestReveal, revealPath, renderSignature]);

  return { requestReveal, suppressActiveRevealRef };
}
