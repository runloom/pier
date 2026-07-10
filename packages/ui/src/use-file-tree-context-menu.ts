import type { FileTreeCompositionOptions } from "@pierre/trees";
import * as React from "react";
import {
  type FileTreeRefs,
  updateFileTreeContextMenuComposition,
} from "./file-tree-internal.ts";

interface FileTreeCompositionModel {
  getComposition(): FileTreeCompositionOptions | undefined;
  setComposition(composition?: FileTreeCompositionOptions): void;
}

export function useFileTreeContextMenuComposition(
  model: FileTreeCompositionModel,
  enabled: boolean,
  refs: { current: FileTreeRefs }
): void {
  const previousEnabledRef = React.useRef(enabled);

  React.useEffect(() => {
    if (previousEnabledRef.current === enabled) {
      return;
    }
    previousEnabledRef.current = enabled;
    model.setComposition(
      updateFileTreeContextMenuComposition(
        model.getComposition(),
        enabled,
        refs
      )
    );
  }, [enabled, model, refs]);
}
