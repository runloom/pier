import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import {
  PierFileTree,
  type PierFileTreeGitStatus,
  type PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { GitFileStatus, GitStatus } from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useEffect, useMemo, useState } from "react";

type GitChangesPanelGitApi = Pick<
  RendererPluginContext["git"],
  "getDiffPatch" | "getFileContent" | "getStatus"
> &
  Partial<Pick<RendererPluginContext["git"], "watch">>;

interface GitChangesPanelParams {
  context?: PanelContext;
  git?: GitChangesPanelGitApi;
  heading?: string;
  hint?: string;
}

interface GitChangesPanelRuntimeProps
  extends IDockviewPanelProps<GitChangesPanelParams> {
  runtimeGit?: GitChangesPanelGitApi;
}

interface GitFilesSnapshot {
  files: readonly GitFileStatus[];
  root: null | string;
}

const EMPTY_GIT_FILES: readonly GitFileStatus[] = [];

function gitLoadErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Failed to load Git status";
}

function gitRootFromContext(context: PanelContext | undefined): string | null {
  return (
    context?.gitRoot ??
    context?.worktreeRoot ??
    context?.projectRootPath ??
    context?.cwd ??
    null
  );
}

function gitFileTreeStatus(file: GitFileStatus): PierFileTreeGitStatus {
  const codes = [file.index, file.worktree];

  if (codes.includes("?")) {
    return "untracked";
  }
  if (codes.includes("!")) {
    return "ignored";
  }
  if (codes.includes("R") || file.origPath != null) {
    return "renamed";
  }
  if (codes.includes("D")) {
    return "deleted";
  }
  if (codes.includes("A")) {
    return "added";
  }

  return "modified";
}

function gitHeadContentPath(file: GitFileStatus): string | null {
  if (file.index === "A" || file.index === "?" || file.worktree === "?") {
    return null;
  }
  return file.origPath ?? file.path;
}

function isStagedOnlyChange(file: GitFileStatus): boolean {
  return file.index !== "." && file.index !== "?" && file.worktree === ".";
}

function gitDiffOptions(file: GitFileStatus | undefined, path: string) {
  if (file && isStagedOnlyChange(file)) {
    return { path, staged: true };
  }

  return { path };
}

function gitFileItems(files: readonly GitFileStatus[]): PierFileTreeItem[] {
  return files.map((file) => ({
    gitStatus: gitFileTreeStatus(file),
    kind: "file",
    path: file.path,
  }));
}

function GitChangesPanelContent({
  runtimeGit,
  ...props
}: GitChangesPanelRuntimeProps) {
  const heading = props.params?.heading ?? "Git Changes";
  const hint = props.params?.hint ?? "Change preview coming soon";
  const git = runtimeGit ?? props.params?.git;
  const root = gitRootFromContext(props.params?.context);
  const [filesSnapshot, setFilesSnapshot] = useState<GitFilesSnapshot>({
    files: EMPTY_GIT_FILES,
    root: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    setFilesSnapshot({ files: EMPTY_GIT_FILES, root });
    setLoaded(false);
    setLoadError(null);
    if (!(git && root)) {
      setLoaded(true);
      return;
    }

    let cancelled = false;
    let refreshGeneration = 0;
    const applyStatus = (status: GitStatus): void => {
      if (!cancelled) {
        setFilesSnapshot({ files: status.files, root });
        setLoadError(null);
        setLoaded(true);
      }
    };

    const runRefresh = () => {
      refreshGeneration += 1;
      const generation = refreshGeneration;
      git
        .getStatus(root)
        .then((status) => {
          if (generation === refreshGeneration) {
            applyStatus(status);
          }
        })
        .catch((error: unknown) => {
          if (!(cancelled || generation !== refreshGeneration)) {
            setFilesSnapshot({ files: EMPTY_GIT_FILES, root });
            setLoadError(gitLoadErrorMessage(error));
            setLoaded(true);
          }
        });
    };

    runRefresh();
    const dispose = git.watch?.(root, (event) => {
      if (event.status) {
        refreshGeneration += 1;
        applyStatus(event.status);
        return;
      }

      runRefresh();
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [git, root]);

  const visibleFiles =
    filesSnapshot.root === root ? filesSnapshot.files : EMPTY_GIT_FILES;

  const items = useMemo(() => gitFileItems(visibleFiles), [visibleFiles]);

  const openPath = useCallback(
    async (path: string) => {
      if (!(git && root)) {
        return;
      }
      const file = visibleFiles.find((candidate) => candidate.path === path);
      await git.getDiffPatch(root, gitDiffOptions(file, path));
      const headPath = file ? gitHeadContentPath(file) : null;
      if (headPath) {
        await git.getFileContent(root, { path: headPath });
      }
    },
    [visibleFiles, git, root]
  );

  const content = useMemo(() => {
    if (!loaded) {
      return <p className="text-muted-foreground text-sm">Loading changes…</p>;
    }
    if (loadError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Unable to load Git changes</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      );
    }
    if (items.length === 0) {
      return <p className="text-muted-foreground text-sm">{hint}</p>;
    }
    return (
      <PierFileTree
        className="min-h-0 w-full flex-1"
        items={items}
        label={heading}
        onOpenPath={openPath}
      />
    );
  }, [heading, hint, items, loadError, loaded, openPath]);
  return (
    <div className="flex h-full flex-col gap-3 bg-background p-4">
      <h1 className="font-semibold text-foreground text-sm">{heading}</h1>
      {content}
    </div>
  );
}

export function createGitChangesPanel(context: RendererPluginContext) {
  return function RegisteredGitChangesPanel(
    props: IDockviewPanelProps<GitChangesPanelParams>
  ) {
    return <GitChangesPanelContent {...props} runtimeGit={context.git} />;
  };
}

export function GitChangesPanel(
  props: IDockviewPanelProps<GitChangesPanelParams>
) {
  return <GitChangesPanelContent {...props} />;
}
