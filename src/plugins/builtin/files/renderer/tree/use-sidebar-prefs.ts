import {
  filesTreeExpansionScopeId,
  getTreeExpansionAuthority,
  type PierFileTreeAutoRevealMode,
  type TreeExpansionAuthority,
} from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY,
  FILES_TREE_AUTO_REVEAL_SETTING_KEY,
  FILES_TREE_AUTO_REVEAL_VALUES,
  FILES_TREE_COMPACT_FOLDERS_SETTING_KEY,
  FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS,
  type FilesTreeAutoRevealMode,
} from "../../settings.ts";
import { bindFilesTreeExpansionPersistence } from "./expansion-persist.ts";
import { ensureFilesTreeAncestorsLoaded } from "./reveal.ts";
import { type FilesTreeList, isExcludedFileTreePath } from "./visibility.ts";

function readAutoRevealMode(
  context: Partial<RendererPluginContext>
): PierFileTreeAutoRevealMode {
  const raw = context.configuration?.get?.<unknown>(
    FILES_TREE_AUTO_REVEAL_SETTING_KEY
  );
  if (
    typeof raw === "string" &&
    (FILES_TREE_AUTO_REVEAL_VALUES as readonly string[]).includes(raw)
  ) {
    return raw as FilesTreeAutoRevealMode;
  }
  return "on";
}

function readAutoRevealExcludePatterns(
  context: Partial<RendererPluginContext>
): string {
  const raw = context.configuration?.get?.<unknown>(
    FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY
  );
  return typeof raw === "string"
    ? raw
    : FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS;
}

/**
 * Expansion authority + tree prefs (compact / autoReveal / exclude) +
 * active-file ancestor load. Selection/scroll stays on PierFileTree
 * `revealPath` (single reveal owner).
 */
export function useFilesTreeSidebarPrefs(options: {
  activeFilePath?: string | null | undefined;
  context: RendererPluginContext;
  list: FilesTreeList;
  root: string;
}): {
  autoReveal: PierFileTreeAutoRevealMode;
  compactFolders: boolean;
  expansionAuthority: TreeExpansionAuthority;
  isAutoRevealExcluded: (path: string) => boolean;
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
  const [autoReveal, setAutoReveal] = useState<PierFileTreeAutoRevealMode>(() =>
    readAutoRevealMode(context)
  );
  const [autoRevealExcludeSource, setAutoRevealExcludeSource] = useState(() =>
    readAutoRevealExcludePatterns(context)
  );

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
      setAutoReveal(readAutoRevealMode(context));
      setAutoRevealExcludeSource(readAutoRevealExcludePatterns(context));
    };
    read();
    return configuration.onDidChange((event) => {
      const affects =
        event.affectsConfiguration?.(FILES_TREE_COMPACT_FOLDERS_SETTING_KEY) !==
          false ||
        event.affectsConfiguration?.(FILES_TREE_AUTO_REVEAL_SETTING_KEY) !==
          false ||
        event.affectsConfiguration?.(
          FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY
        ) !== false;
      if (affects) {
        read();
      }
    });
  }, [context]);

  const isAutoRevealExcluded = useCallback(
    (path: string) => isExcludedFileTreePath(path, autoRevealExcludeSource),
    [autoRevealExcludeSource]
  );

  // Active file: materialize ancestors only when auto-reveal will run.
  // PierFileTree revealPath owns select/scroll so we do not run two pipelines.
  useEffect(() => {
    if (!activeFilePath || autoReveal === "off") {
      return;
    }
    if (isAutoRevealExcluded(activeFilePath)) {
      return;
    }
    ensureFilesTreeAncestorsLoaded({
      list,
      path: activeFilePath,
      root,
    }).catch(() => undefined);
  }, [activeFilePath, autoReveal, isAutoRevealExcluded, list, root]);

  return {
    autoReveal,
    compactFolders,
    expansionAuthority,
    isAutoRevealExcluded,
  };
}
