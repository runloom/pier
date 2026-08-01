import type { FileTree } from "@pierre/trees";
import * as React from "react";
import {
  collectKnownDirectoryPaths,
  resolveExpandedPaths,
  type TreeExpansionSeed,
} from "./tree-expansion-apply.ts";
import type { TreeExpansionAuthority } from "./tree-expansion-authority.ts";
import {
  cloneCompositionForRedraw,
  collectPreservedExpandedDirectoryPaths,
  pathSetMutation,
  samePaths,
  stripTrailingSlash,
} from "./tree-model.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeItem,
  PierFileTreeScrollController,
} from "./tree-types.ts";

interface UseFileTreePathSyncInput {
  activeSearchRef: React.MutableRefObject<string | null>;
  captureSnapshot: PierFileTreeScrollController["captureSnapshot"];
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined;
  expandedDirectoriesRef: React.MutableRefObject<Map<string, boolean>>;
  expansionAuthority?: TreeExpansionAuthority | undefined;
  expansionSeed?: TreeExpansionSeed | undefined;
  items: readonly PierFileTreeItem[];
  model: FileTree;
  modelAheadMovesRef: React.MutableRefObject<Map<string, string>>;
  paths: readonly string[];
  renderSignature: string;
  restoreSnapshotSoon: PierFileTreeScrollController["restoreSnapshotSoon"];
}

/**
 * Bridge store-projected `items` into official model path mutations.
 * Multi-path changes use batch first; resetPaths is residual for batch throw.
 */
export function useFileTreePathSync({
  activeSearchRef,
  captureSnapshot,
  directoryStates,
  expandedDirectoriesRef,
  expansionAuthority,
  expansionSeed = "none",
  items,
  model,
  modelAheadMovesRef,
  paths,
  renderSignature,
  restoreSnapshotSoon,
}: UseFileTreePathSyncInput): void {
  const didMountRef = React.useRef(false);
  const previousPathsRef = React.useRef<readonly string[]>(paths);
  const previousRenderSignatureRef = React.useRef(renderSignature);
  const previousKnownDirsRef = React.useRef(collectKnownDirectoryPaths(items));

  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
      // Cold start: keep restored nested intents even when only the root listing
      // is projected. resolveExpandedPaths filters to currently known dirs for
      // the model; do not prune "unknown because not loaded yet."
      previousKnownDirsRef.current = collectKnownDirectoryPaths(items);
      return;
    }

    const previousPaths = previousPathsRef.current;
    if (samePaths(previousPaths, paths)) {
      if (previousRenderSignatureRef.current !== renderSignature) {
        model.setComposition(cloneCompositionForRedraw(model.getComposition()));
      }
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
      return;
    }

    const mutation = pathSetMutation(previousPaths, paths);
    if (mutation === null) {
      // same path set, possibly reordered — official model is path-set based
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
      return;
    }

    const nextKnown = collectKnownDirectoryPaths(items);
    if (expansionAuthority) {
      for (const op of mutation) {
        if (op.type === "move") {
          expansionAuthority.remapPath(
            stripTrailingSlash(op.from),
            stripTrailingSlash(op.to)
          );
        }
      }
      // Only drop intents for dirs that were known and are now gone (delete),
      // not for nested paths still waiting on lazy list.
      expansionAuthority.reconcileKnownDirectories(
        previousKnownDirsRef.current,
        nextKnown
      );
    }
    previousKnownDirsRef.current = nextKnown;

    const scrollSnapshot = captureSnapshot();

    const aheadMoves = modelAheadMovesRef.current;
    const alreadyAppliedByModel =
      mutation.length === 1 &&
      mutation[0]?.type === "move" &&
      aheadMoves.get(stripTrailingSlash(mutation[0].from)) ===
        stripTrailingSlash(mutation[0].to);

    const resolveExpandedForReset = (): string[] => {
      if (expansionAuthority) {
        return resolveExpandedPaths(items, expansionAuthority.getIntent(), {
          ...(directoryStates === undefined ? {} : { directoryStates }),
          propagateCompactChains: true,
          // After first interaction, intent is non-empty; never re-seed over it.
          seed:
            expansionAuthority.getIntent().expanded.size === 0 &&
            expansionAuthority.getIntent().collapsed.size === 0
              ? expansionSeed
              : "none",
        });
      }
      return collectPreservedExpandedDirectoryPaths(
        items,
        expandedDirectoriesRef.current,
        directoryStates
      );
    };

    try {
      if (alreadyAppliedByModel && mutation[0]?.type === "move") {
        aheadMoves.delete(stripTrailingSlash(mutation[0].from));
      } else {
        model.batch(mutation);
        for (const [from, to] of aheadMoves) {
          if (
            mutation.some(
              (op) =>
                op.type === "move" &&
                stripTrailingSlash(op.from) === from &&
                stripTrailingSlash(op.to) === to
            )
          ) {
            aheadMoves.delete(from);
          }
        }
      }
    } catch {
      // batch failed — residual full replacement with search clear/replay
      const expandedPaths = resolveExpandedForReset();
      const activeSearch = activeSearchRef.current;
      if (activeSearch != null) {
        model.setSearch(null);
      }
      model.resetPaths(paths, { initialExpandedPaths: expandedPaths });
      if (activeSearch != null) {
        model.setSearch(activeSearch);
      }
    }

    // 终态：status delta 后多锁几帧，避免 group 搬家时滚动条被 reveal 冲掉。
    restoreSnapshotSoon(scrollSnapshot, {
      frames: 4,
      lock: true,
    });

    previousPathsRef.current = paths;
    previousRenderSignatureRef.current = renderSignature;
  }, [
    activeSearchRef,
    captureSnapshot,
    directoryStates,
    expandedDirectoriesRef,
    expansionAuthority,
    expansionSeed,
    items,
    model,
    modelAheadMovesRef,
    paths,
    renderSignature,
    restoreSnapshotSoon,
  ]);
}
