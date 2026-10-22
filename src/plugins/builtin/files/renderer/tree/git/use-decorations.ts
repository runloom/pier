import type { PierFileTreeGitStatus } from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { useFilesTreeVisibility } from "../use-visibility.ts";
import {
  buildPrefixedGitStatusByPath,
  EMPTY_GIT_DECORATIONS,
  type FilesGitDecorations,
  mergeGitStatusByPath,
  splitIgnoredEntries,
} from "./decorations.ts";
import { repoDirectoryAbsolute } from "./repo-scope.ts";

type TreeVisibility = ReturnType<typeof useFilesTreeVisibility>["controller"];

interface PrefixedStatus {
  files: GitStatus["files"];
  prefix: string;
}

function readRepoScope(treeVisibility: TreeVisibility, root: string) {
  return treeVisibility.repoScope(root);
}

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
  // 仓库边界集合与「根是不是仓库」都进快照：多仓库父目录下每个仓库各自一份
  // status，边界一发现就要补上，不能等到下一次 git 事件。
  const repoScope = useSyncExternalStore(
    (onChange) => treeVisibility.subscribeRepoPrefixes(root, onChange),
    () => readRepoScope(treeVisibility, root),
    () => readRepoScope(treeVisibility, root)
  );

  useEffect(() => {
    const gitApi = (context as Partial<RendererPluginContext>).git;
    if (!(gitApi?.getStatus && gitApi.watch)) {
      return;
    }
    const getStatus = gitApi.getStatus.bind(gitApi);
    const watch = gitApi.watch.bind(gitApi);
    const statusPrefixes = repoScope.prefixes.filter(
      (prefix) => prefix.length > 0 || repoScope.rootIsRepo
    );
    if (statusPrefixes.length === 0) {
      return;
    }

    let disposed = false;
    // 按仓库保存，最后合并成一张树根相对的表。单个仓库的 watcher 事件只替换
    // 自己那一份，不能把其它仓库的标记一起冲掉。
    const statusesByPrefix = new Map<
      string,
      ReadonlyMap<string, PierFileTreeGitStatus>
    >();
    const publish = () => {
      if (disposed) {
        return;
      }
      const changedByPath = new Map<string, PierFileTreeGitStatus>();
      for (const statuses of statusesByPrefix.values()) {
        mergeGitStatusByPath(changedByPath, statuses);
      }
      setGitDecorations((previous) => ({ ...previous, changedByPath }));
    };
    const replacePrefix = (prefix: string, files: GitStatus["files"]) => {
      if (disposed) {
        return;
      }
      statusesByPrefix.set(prefix, buildPrefixedGitStatusByPath(prefix, files));
      publish();
    };
    const replaceAll = (
      results: readonly { files: GitStatus["files"]; prefix: string }[]
    ) => {
      if (disposed) {
        return;
      }
      statusesByPrefix.clear();
      for (const result of results) {
        statusesByPrefix.set(
          result.prefix,
          buildPrefixedGitStatusByPath(result.prefix, result.files)
        );
      }
      publish();
    };
    const readStatuses = () => {
      Promise.all(
        statusPrefixes.map(async (prefix): Promise<PrefixedStatus | null> => {
          try {
            const status = await getStatus(repoDirectoryAbsolute(root, prefix));
            return { files: status.files, prefix };
          } catch {
            return null;
          }
        })
      )
        .then((results) =>
          replaceAll(
            results.filter(
              (result): result is PrefixedStatus => result !== null
            )
          )
        )
        .catch(() => undefined);
    };
    const refreshIgnored = () => {
      treeVisibility
        .refreshGitIgnored(root)
        .then(({ changed, entries }) => {
          if (disposed) {
            return;
          }
          setGitDecorations((previous) => ({
            ...previous,
            ...splitIgnoredEntries(entries),
          }));
          if (changed && !treeVisibility.showsGitIgnoredFiles()) {
            reloadTreeVisibility().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };
    const refresh = () => {
      readStatuses();
      refreshIgnored();
    };

    refresh();
    const unsubscribes: (() => void)[] = [];
    for (const prefix of statusPrefixes) {
      const directory = repoDirectoryAbsolute(root, prefix);
      try {
        unsubscribes.push(
          watch(directory, (event) => {
            if (event.status) {
              replacePrefix(prefix, event.status.files);
              refreshIgnored();
              return;
            }
            refresh();
          })
        );
      } catch {
        // git capability may be unavailable
      }
    }
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [context, reloadTreeVisibility, repoScope, root, treeVisibility]);
  return gitDecorations;
}
