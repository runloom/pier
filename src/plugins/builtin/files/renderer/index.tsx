import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  type PierDirectoryLoadState,
  PierFileTree,
  type PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FolderTree } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FILES_PANEL_ID, FILES_PLUGIN_ID } from "../manifest.ts";

interface FilesExplorerPanelParams {
  context?: PanelContext;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

function isDirectoryDescendant(
  entryPath: string,
  directoryPath: string
): boolean {
  return directoryPath === "" || entryPath.startsWith(`${directoryPath}/`);
}

function mergeDirectoryEntries(
  previousEntries: ReadonlyMap<string, FileEntry>,
  directoryPath: string,
  loadedEntries: readonly FileEntry[]
): Map<string, FileEntry> {
  const nextEntries = new Map(previousEntries);

  for (const entryPath of nextEntries.keys()) {
    if (isDirectoryDescendant(entryPath, directoryPath)) {
      nextEntries.delete(entryPath);
    }
  }

  for (const entry of loadedEntries) {
    nextEntries.set(entry.path, entry);
  }

  return nextEntries;
}

function entriesByPath(entries: readonly FileEntry[]): Map<string, FileEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function toTreeItem(entry: FileEntry): PierFileTreeItem {
  if (entry.kind === "directory") {
    return {
      hasChildren: "unknown",
      kind: "directory",
      path: entry.path,
    };
  }

  return {
    kind: "file",
    path: entry.path,
  };
}

function createFilesExplorerPanel(context: RendererPluginContext) {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return function FilesExplorerPanel(
    props: IDockviewPanelProps<FilesExplorerPanelParams>
  ) {
    const panelContext = props.params?.context;
    const root =
      panelContext?.projectRoot ??
      panelContext?.worktreeRoot ??
      panelContext?.gitRoot ??
      panelContext?.cwd ??
      panelContext?.openedPath ??
      null;
    const rootRef = useRef(root);
    rootRef.current = root;
    const [fileEntriesByPath, setFileEntriesByPath] = useState<
      ReadonlyMap<string, FileEntry>
    >(new Map());
    const [directoryStatesByPath, setDirectoryStatesByPath] = useState<
      ReadonlyMap<string, PierDirectoryLoadState>
    >(new Map());
    const [rootLoaded, setRootLoaded] = useState(false);
    const [rootError, setRootError] = useState<string | null>(null);

    useEffect(() => {
      if (!root) {
        setFileEntriesByPath(new Map());
        setDirectoryStatesByPath(new Map());
        setRootError(null);
        setRootLoaded(true);
        return;
      }

      let cancelled = false;
      setFileEntriesByPath(new Map());
      setDirectoryStatesByPath(new Map());
      setRootError(null);
      setRootLoaded(false);

      context.files
        .list(root, { path: "" })
        .then((nextEntries) => {
          if (cancelled || rootRef.current !== root) {
            return;
          }
          setFileEntriesByPath(entriesByPath(nextEntries));
          setRootLoaded(true);
        })
        .catch((loadError: unknown) => {
          if (cancelled || rootRef.current !== root) {
            return;
          }
          setRootError(
            errorMessage(
              loadError,
              t("panel.loadError.fallback", "Failed to load files")
            )
          );
          setFileEntriesByPath(new Map());
          setRootLoaded(true);
        });

      return () => {
        cancelled = true;
      };
    }, [root]);

    const loadDirectory = useCallback(
      async (path: string) => {
        if (!root) {
          return;
        }

        const activeRoot = root;
        setDirectoryStatesByPath((currentStates) => {
          const nextStates = new Map(currentStates);
          nextStates.set(path, "loading");
          return nextStates;
        });

        try {
          const nextEntries = await context.files.list(activeRoot, { path });

          if (rootRef.current !== activeRoot) {
            return;
          }

          setFileEntriesByPath((currentEntries) =>
            mergeDirectoryEntries(currentEntries, path, nextEntries)
          );
          setDirectoryStatesByPath((currentStates) => {
            const nextStates = new Map(currentStates);
            nextStates.set(path, nextEntries.length === 0 ? "empty" : "loaded");
            return nextStates;
          });
        } catch {
          if (rootRef.current !== activeRoot) {
            return;
          }

          setDirectoryStatesByPath((currentStates) => {
            const nextStates = new Map(currentStates);
            nextStates.set(path, "error");
            return nextStates;
          });
        }
      },
      [root]
    );

    const items = useMemo<PierFileTreeItem[]>(
      () => [...fileEntriesByPath.values()].map(toTreeItem),
      [fileEntriesByPath]
    );

    const content = useMemo(() => {
      if (!root) {
        return (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {t("panel.noProjectContext.title", "No project context")}
              </EmptyTitle>
              <EmptyDescription>
                {t(
                  "panel.noProjectContext.description",
                  "Open a project or worktree to browse files."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        );
      }

      if (rootError) {
        return (
          <Alert variant="destructive">
            <AlertTitle>
              {t("panel.loadError.title", "Unable to load files")}
            </AlertTitle>
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        );
      }

      if (!rootLoaded) {
        return (
          <div
            aria-label={t("panel.loading.label", "Loading files")}
            className="flex min-h-0 flex-1 flex-col gap-2"
            role="status"
          >
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-36" />
          </div>
        );
      }

      if (items.length === 0) {
        return (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {t("panel.empty.title", "No files found")}
              </EmptyTitle>
              <EmptyDescription>
                {t(
                  "panel.empty.description",
                  "This project root does not contain files to show."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        );
      }

      return (
        <PierFileTree
          className="min-h-0 w-full flex-1"
          directoryStates={directoryStatesByPath}
          items={items}
          label={t("panel.tree.label", "Files")}
          onLoadDirectory={loadDirectory}
        />
      );
    }, [
      directoryStatesByPath,
      items,
      loadDirectory,
      root,
      rootError,
      rootLoaded,
    ]);

    return (
      <div className="flex h-full flex-col gap-3 bg-background p-4">
        <h1 className="font-semibold text-foreground text-sm">
          {t("panel.title", "Files")}
        </h1>
        {content}
      </div>
    );
  };
}

export const filesRendererPlugin: RendererPluginModule = {
  activate: (context) =>
    context.panels.register({
      component: createFilesExplorerPanel(context),
      icon: FolderTree,
      id: FILES_PANEL_ID,
      kind: "web",
      title: context.i18n.t("panel.title", undefined, "Files"),
    }),
  id: FILES_PLUGIN_ID,
};
