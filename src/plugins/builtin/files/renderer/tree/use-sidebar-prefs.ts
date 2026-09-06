import {
  filesTreeExpansionScopeId,
  getTreeExpansionAuthority,
  type PierFileTreeAutoRevealMode,
  type TreeExpansionAuthority,
} from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY,
  FILES_TREE_AUTO_REVEAL_SETTING_KEY,
  FILES_TREE_AUTO_REVEAL_VALUES,
  FILES_TREE_COMPACT_FOLDERS_SETTING_KEY,
  FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS,
  type FilesTreeAutoRevealMode,
} from "../../settings.ts";
import {
  bindFilesTreeExpansionPersistence,
  hydrateFilesTreeExpansion,
} from "./expansion-persist.ts";
import { ensureFilesTreeAncestorsLoaded } from "./reveal.ts";
import {
  type FilesTreeList,
  type FilesTreeVisibilityController,
  isExcludedFileTreePath,
} from "./visibility.ts";

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
 * Expansion authority + tree prefs (compact / autoReveal / exclude) + active-file
 * visibility pinning + ancestor load. Selection/scroll stays on PierFileTree
 * `revealPath` (single reveal owner).
 *
 * Git-ignore hiding is overridden for the active file: opening a hidden
 * (Git-ignored) document pins its directory chain visible until another file
 * becomes active. autoRevealExcludePatterns still suppress passive tracking.
 */
export function useFilesTreeSidebarPrefs(options: {
  activeFilePath?: string | null | undefined;
  context: RendererPluginContext;
  controller: FilesTreeVisibilityController;
  list: FilesTreeList;
  reload: () => Promise<void>;
  root: string;
}): {
  autoReveal: PierFileTreeAutoRevealMode;
  compactFolders: boolean;
  expansionAuthority: TreeExpansionAuthority;
  isAutoRevealExcluded: (path: string) => boolean;
} {
  const { activeFilePath, context, controller, list, reload, root } = options;

  const expansionAuthority = useMemo(
    () => getTreeExpansionAuthority(filesTreeExpansionScopeId(root)),
    [root]
  );
  hydrateFilesTreeExpansion(root, expansionAuthority);
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

  const previousActiveRef = useRef<{ path: string; root: string } | null>(null);

  // Active file: pin it visible (unpin the previous one), materialize ancestors.
  // PierFileTree revealPath owns select/scroll so we do not run two pipelines.
  useEffect(() => {
    const previous = previousActiveRef.current;
    previousActiveRef.current = activeFilePath
      ? { path: activeFilePath, root }
      : null;
    let pinsChanged = false;
    if (
      previous &&
      (previous.root !== root || previous.path !== activeFilePath)
    ) {
      // Unpin against its own root so project switches cannot leak pins.
      pinsChanged =
        controller.unpinPath(previous.root, previous.path) || pinsChanged;
    }
    const isActiveRevealExcluded = Boolean(
      activeFilePath && isAutoRevealExcluded(activeFilePath)
    );
    if (activeFilePath && !isActiveRevealExcluded) {
      pinsChanged = controller.pinPath(root, activeFilePath) || pinsChanged;
    }

    const prepare = async () => {
      // Reload only when the pin/unpin actually changes visible content
      // (hidden Git-ignored chain appearing or collapsing again). A pin
      // released on another root is not checked against the current root.
      if (pinsChanged && !controller.showsGitIgnoredFiles()) {
        const previousCandidate =
          previous && previous.root === root ? previous.path : null;
        for (const candidate of [previousCandidate, activeFilePath]) {
          if (
            candidate &&
            (await controller.isPathHiddenByGitIgnore(root, candidate))
          ) {
            await reload();
            break;
          }
        }
      }
      if (!activeFilePath || autoReveal === "off" || isActiveRevealExcluded) {
        return;
      }
      await ensureFilesTreeAncestorsLoaded({
        list,
        path: activeFilePath,
        root,
      });
    };
    prepare().catch(() => undefined);
  }, [
    activeFilePath,
    autoReveal,
    controller,
    isAutoRevealExcluded,
    list,
    reload,
    root,
  ]);

  return {
    autoReveal,
    compactFolders,
    expansionAuthority,
    isAutoRevealExcluded,
  };
}
