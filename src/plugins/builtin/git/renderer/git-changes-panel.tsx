import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import {
  PierFileTree,
  type PierFileTreeGitStatus,
  type PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type {
  GitDiffPatch,
  GitFileStatus,
  GitStatus,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GitDiffView } from "./git-diff-view.tsx";
import { pluginText } from "./git-plugin-text.ts";

type GitChangesPanelGitApi = Pick<
  RendererPluginContext["git"],
  "getDiffPatch" | "getStatus"
> &
  Partial<Pick<RendererPluginContext["git"], "watch">>;

/**
 * i18n 文案解析器:注册路径由 createGitChangesPanel 闭包注入宿主 i18n;
 * 直挂组件(布局恢复兜底)没有插件 context,退回英文 fallback。
 */
type GitChangesTextResolver = (key: string, fallback: string) => string;

interface GitChangesPanelParams {
  context?: PanelContext;
  git?: GitChangesPanelGitApi;
  heading?: string;
  hint?: string;
}

interface GitChangesPanelRuntimeProps
  extends IDockviewPanelProps<GitChangesPanelParams> {
  runtimeGit?: GitChangesPanelGitApi;
  runtimeText?: GitChangesTextResolver;
}

interface GitFilesSnapshot {
  files: readonly GitFileStatus[];
  root: null | string;
}

/**
 * diff 拉取状态机。非 idle 态都带 path:选中切换后 effect 才会覆盖状态,
 * 中间那一帧渲染靠 path 匹配判定,避免把旧文件的 patch/错误闪现到新选中上。
 */
type GitDiffFetchState =
  | { kind: "error"; message: string; path: string }
  | { kind: "idle" }
  | { kind: "loaded"; patch: GitDiffPatch; path: string }
  | { kind: "loading"; path: string };

const EMPTY_GIT_FILES: readonly GitFileStatus[] = [];
const IDLE_DIFF_STATE: GitDiffFetchState = { kind: "idle" };
const FALLBACK_TEXT: GitChangesTextResolver = (_key, fallback) => fallback;

function gitErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
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
  runtimeText,
  ...props
}: GitChangesPanelRuntimeProps) {
  const text = runtimeText ?? FALLBACK_TEXT;
  const heading =
    props.params?.heading ?? text("panelTitle.gitChanges", "Git Changes");
  const hint =
    props.params?.hint ??
    text("panelHint.gitChangesClean", "No changes in the working tree");
  const git = runtimeGit ?? props.params?.git;
  const root = gitRootFromContext(props.params?.context);
  const [filesSnapshot, setFilesSnapshot] = useState<GitFilesSnapshot>({
    files: EMPTY_GIT_FILES,
    root: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffState, setDiffState] =
    useState<GitDiffFetchState>(IDLE_DIFF_STATE);
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
            setLoadError(
              gitErrorMessage(
                error,
                text("changes.loadErrorFallback", "Failed to load Git status")
              )
            );
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
  }, [git, root, text]);

  const visibleFiles =
    filesSnapshot.root === root ? filesSnapshot.files : EMPTY_GIT_FILES;

  const items = useMemo(() => gitFileItems(visibleFiles), [visibleFiles]);

  const selectedFile = useMemo(
    () => visibleFiles.find((file) => file.path === selectedPath),
    [visibleFiles, selectedPath]
  );

  // 选中文件或状态列表变化时(重新)拉 diff。status 刷新会换掉 file 对象引用,
  // 因此 watch 触发的刷新自然带来重拉;文件已不在变更列表时清掉选中。
  useEffect(() => {
    if (!selectedPath) {
      setDiffState(IDLE_DIFF_STATE);
      return;
    }
    if (!(git && root)) {
      return;
    }
    if (!selectedFile) {
      setSelectedPath(null);
      return;
    }

    // cleanup 置位的 cancelled 即代际防护:更新的请求发出时旧 effect 必先清理。
    let cancelled = false;
    setDiffState({ kind: "loading", path: selectedPath });
    git
      .getDiffPatch(root, gitDiffOptions(selectedFile, selectedPath))
      .then((patch) => {
        if (!cancelled) {
          setDiffState({ kind: "loaded", patch, path: selectedPath });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDiffState({
            kind: "error",
            message: gitErrorMessage(
              error,
              text("changes.diffErrorFallback", "Failed to load diff")
            ),
            path: selectedPath,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [git, root, selectedPath, selectedFile, text]);

  const openPath = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const diffPane = useMemo(() => {
    if (!selectedPath) {
      return (
        <p className="text-muted-foreground text-sm">
          {text("changes.selectFile", "Select a file to preview its changes")}
        </p>
      );
    }
    if (diffState.kind === "error" && diffState.path === selectedPath) {
      return (
        <Alert variant="destructive">
          <AlertTitle>
            {text("changes.diffErrorTitle", "Unable to load diff")}
          </AlertTitle>
          <AlertDescription>{diffState.message}</AlertDescription>
        </Alert>
      );
    }
    if (diffState.kind === "loaded" && diffState.path === selectedPath) {
      return (
        <GitDiffView
          patch={diffState.patch}
          path={selectedPath}
          text={{
            binaryFile: text(
              "changes.binaryFile",
              "Binary file cannot be previewed"
            ),
            noChanges: text("changes.noChanges", "No changes to display"),
          }}
        />
      );
    }
    // loading 或状态尚未跟上新选中的过渡帧,统一按加载中呈现。
    return (
      <p className="text-muted-foreground text-sm">
        {text("changes.diffLoading", "Loading diff…")}
      </p>
    );
  }, [diffState, selectedPath, text]);

  const content = useMemo(() => {
    if (!loaded) {
      return (
        <p className="text-muted-foreground text-sm">
          {text("changes.loading", "Loading changes…")}
        </p>
      );
    }
    if (loadError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>
            {text("changes.loadErrorTitle", "Unable to load Git changes")}
          </AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      );
    }
    if (items.length === 0) {
      return <p className="text-muted-foreground text-sm">{hint}</p>;
    }
    return (
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-64 shrink-0 flex-col">
          <PierFileTree
            className="min-h-0 w-full flex-1"
            items={items}
            label={heading}
            onOpenPath={openPath}
          />
        </div>
        <div
          className="min-w-0 flex-1 overflow-auto"
          data-testid="git-diff-pane"
        >
          {diffPane}
        </div>
      </div>
    );
  }, [diffPane, heading, hint, items, loadError, loaded, openPath, text]);
  return (
    <div className="flex h-full flex-col gap-3 bg-background p-4">
      <h1 className="font-semibold text-foreground text-sm">{heading}</h1>
      {content}
    </div>
  );
}

export function createGitChangesPanel(context: RendererPluginContext) {
  const resolveText: GitChangesTextResolver = (key, fallback) =>
    pluginText(context, key, fallback);
  return function RegisteredGitChangesPanel(
    props: IDockviewPanelProps<GitChangesPanelParams>
  ) {
    return (
      <GitChangesPanelContent
        {...props}
        runtimeGit={context.git}
        runtimeText={resolveText}
      />
    );
  };
}

export function GitChangesPanel(
  props: IDockviewPanelProps<GitChangesPanelParams>
) {
  return <GitChangesPanelContent {...props} />;
}
