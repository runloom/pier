import type {
  FileTreeDragAndDropConfig,
  FileTreeRenamingConfig,
} from "@pierre/trees";
import type { FileTreeRefs } from "./tree-internal.ts";
import { lastSegment, stripTrailingSlash } from "./tree-model.ts";
import type { FileTreeRenameDeliveryRef } from "./tree-rename-session.ts";

export const FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8;

export function fileTreeDragAndDropConfig(
  readRefs: () => FileTreeRefs
): FileTreeDragAndDropConfig {
  return {
    commitOnDrop: false,
    pointerDragThresholdPx: FILE_TREE_POINTER_DRAG_THRESHOLD_PX,
    onDropComplete: (event) => {
      const handler = readRefs().onMovePaths;
      if (!handler) {
        return;
      }
      const targetDirOfficial =
        event.target.kind === "directory" ? event.target.directoryPath : null;
      const targetDir =
        targetDirOfficial === null ? "" : stripTrailingSlash(targetDirOfficial);
      const moves = event.draggedPaths.map((draggedPath) => {
        const from = stripTrailingSlash(draggedPath);
        const name = lastSegment(from);
        return {
          from,
          to: targetDir.length > 0 ? `${targetDir}/${name}` : name,
        };
      });
      if (moves.length > 0) {
        handler(moves);
      }
    },
  };
}

export function fileTreeRenamingConfig(
  readRefs: () => FileTreeRefs,
  modelAheadMovesRef: { current: Map<string, string> },
  renameDeliveryRef: FileTreeRenameDeliveryRef
): FileTreeRenamingConfig {
  return {
    onRename: (event) => {
      const from = stripTrailingSlash(event.sourcePath);
      const to = stripTrailingSlash(event.destinationPath);
      if (from !== to) {
        modelAheadMovesRef.current.set(from, to);
      }
      try {
        readRefs().onRenamePath?.({
          from,
          isFolder: event.isFolder,
          to,
        });
      } finally {
        renameDeliveryRef.current?.();
      }
    },
  };
}
