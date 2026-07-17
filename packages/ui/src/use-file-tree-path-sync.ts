import type { FileTree } from "@pierre/trees";
import * as React from "react";
import {
  cloneCompositionForRedraw,
  collectPreservedExpandedDirectoryPaths,
  pathSetMutation,
  samePaths,
  stripTrailingSlash,
} from "./file-tree-model.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeItem,
  PierFileTreeScrollController,
} from "./file-tree-types.ts";

interface UseFileTreePathSyncInput {
  activeSearchRef: React.MutableRefObject<string | null>;
  captureSnapshot: PierFileTreeScrollController["captureSnapshot"];
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined;
  expandedDirectoriesRef: React.MutableRefObject<Map<string, boolean>>;
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

  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
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

    const scrollSnapshot = captureSnapshot();

    const aheadMoves = modelAheadMovesRef.current;
    const alreadyAppliedByModel =
      mutation.length === 1 &&
      mutation[0]?.type === "move" &&
      aheadMoves.get(stripTrailingSlash(mutation[0].from)) ===
        stripTrailingSlash(mutation[0].to);

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
      const expandedPaths = collectPreservedExpandedDirectoryPaths(
        items,
        expandedDirectoriesRef.current,
        directoryStates
      );
      const activeSearch = activeSearchRef.current;
      if (activeSearch != null) {
        model.setSearch(null);
      }
      model.resetPaths(paths, { initialExpandedPaths: expandedPaths });
      if (activeSearch != null) {
        model.setSearch(activeSearch);
      }
    }

    restoreSnapshotSoon(scrollSnapshot, {
      frames: 2,
      lock: true,
    });

    previousPathsRef.current = paths;
    previousRenderSignatureRef.current = renderSignature;
  }, [
    activeSearchRef,
    captureSnapshot,
    directoryStates,
    expandedDirectoriesRef,
    items,
    model,
    modelAheadMovesRef,
    paths,
    renderSignature,
    restoreSnapshotSoon,
  ]);
}
