import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { useEffect, useState } from "react";
import {
  buildGitStatusByPath,
  EMPTY_GIT_DECORATIONS,
  type FilesGitDecorations,
  splitIgnoredEntries,
} from "./git-decorations.ts";
import type { useFilesTreeVisibility } from "./use-visibility.ts";

type TreeVisibility = ReturnType<typeof useFilesTreeVisibility>["controller"];

export function useFilesTreeGitDecorations(options: {
  context: RendererPluginContext;
  reloadTreeVisibility: () => Promise<void>;
  root: string;
  treeVisibility: TreeVisibility;
}): FilesGitDecorations {
  const { context, reloadTreeVisibility, root, treeVisibility } = options;
  const [gitDecorations, setGitDecorations] = useState<FilesGitDecorations>(
    EMPTY_GIT_DECORATIONS
  );
  useEffect(() => {
    const gitApi = (context as Partial<RendererPluginContext>).git;
    if (!gitApi?.getStatus) {
      return;
    }
    let disposed = false;
    const applyStatus = (status: GitStatus | undefined) => {
      if (!disposed && status) {
        setGitDecorations((previous) => ({
          ...previous,
          changedByPath: buildGitStatusByPath(status.files),
        }));
      }
    };
    const refreshIgnored = () => {
      treeVisibility
        .refreshGitIgnored(root)
        .then(({ changed, entries }) => {
          if (!disposed) {
            setGitDecorations((previous) => ({
              ...previous,
              ...splitIgnoredEntries(entries),
            }));
            if (changed && !treeVisibility.showsGitIgnoredFiles()) {
              reloadTreeVisibility().catch(() => undefined);
            }
          }
        })
        .catch(() => undefined);
    };
    const refresh = () => {
      gitApi
        .getStatus(root)
        .then(applyStatus)
        .catch(() => undefined);
      refreshIgnored();
    };
    refresh();
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = gitApi.watch(root, (event) => {
        if (event.status) {
          applyStatus(event.status);
          refreshIgnored();
        } else {
          refresh();
        }
      });
    } catch {
      // git capability may be unavailable
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [context, reloadTreeVisibility, root, treeVisibility]);
  return gitDecorations;
}
