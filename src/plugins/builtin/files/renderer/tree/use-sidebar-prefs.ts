import {
  filesTreeExpansionScopeId,
  getTreeExpansionAuthority,
  type TreeExpansionAuthority,
} from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect, useMemo, useState } from "react";
import { FILES_TREE_COMPACT_FOLDERS_SETTING_KEY } from "../../settings.ts";
import { bindFilesTreeExpansionPersistence } from "./expansion-persist.ts";
import { ensureFilesTreeAncestorsLoaded } from "./reveal.ts";
import type { FilesTreeList } from "./visibility.ts";

/**
 * Expansion authority + compact-folders preference + active-file ancestor load.
 * Selection/scroll stays on PierFileTree `revealPath` (single reveal owner).
 */
export function useFilesTreeSidebarPrefs(options: {
  activeFilePath?: string | null | undefined;
  context: RendererPluginContext;
  list: FilesTreeList;
  root: string;
}): {
  compactFolders: boolean;
  expansionAuthority: TreeExpansionAuthority;
} {
  const { activeFilePath, context, list, root } = options;

  const expansionAuthority = useMemo(
    () => getTreeExpansionAuthority(filesTreeExpansionScopeId(root)),
    [root]
  );
  useEffect(
    () => bindFilesTreeExpansionPersistence(root, expansionAuthority),
    [expansionAuthority, root]
  );

  const [compactFolders, setCompactFolders] = useState(() => {
    const value = (
      context as Partial<RendererPluginContext>
    ).configuration?.get?.<boolean>(FILES_TREE_COMPACT_FOLDERS_SETTING_KEY);
    return value !== false;
  });
  useEffect(() => {
    const configuration = (context as Partial<RendererPluginContext>)
      .configuration;
    if (!configuration?.onDidChange) {
      return;
    }
    const read = () => {
      setCompactFolders(
        configuration.get?.<boolean>(FILES_TREE_COMPACT_FOLDERS_SETTING_KEY) !==
          false
      );
    };
    read();
    return configuration.onDidChange((event) => {
      if (
        event.affectsConfiguration?.(FILES_TREE_COMPACT_FOLDERS_SETTING_KEY) !==
        false
      ) {
        read();
      }
    });
  }, [context]);

  // Active file: materialize ancestors only. PierFileTree revealPath owns
  // select/scroll so we do not run two reveal/retry pipelines.
  useEffect(() => {
    if (!activeFilePath) {
      return;
    }
    ensureFilesTreeAncestorsLoaded({
      list,
      path: activeFilePath,
      root,
    }).catch(() => undefined);
  }, [activeFilePath, list, root]);

  return { compactFolders, expansionAuthority };
}
