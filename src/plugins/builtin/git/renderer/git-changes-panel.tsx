import { Alert, AlertTitle } from "@pier/ui/alert.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { usePanelSidebarCollapsed } from "@pier/ui/use-panel-sidebar-preference.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import {
  type GitReviewIndexEntry,
  type GitReviewScope,
  gitReviewScopeSchema,
} from "@shared/contracts/git-review.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { pluginText } from "./git-plugin-text.ts";
import { preloadReviewCodeView } from "./git-review-code-view.tsx";
import { ReviewDocuments } from "./git-review-content.tsx";
import { ReviewFeedback, ReviewLoading } from "./git-review-feedback.tsx";
import {
  GitReviewIndexLoader,
  type GitReviewIndexLoaderSnapshot,
} from "./git-review-index-loader.ts";
import { GitReviewPanelLayout } from "./git-review-panel-layout.tsx";
import {
  clearReviewSession,
  patchReviewSession,
  readReviewSession,
} from "./git-review-session-cache.ts";
import { gitReviewTreeModel } from "./git-review-tree.tsx";

const EMPTY_REVIEW_ENTRIES: readonly GitReviewIndexEntry[] = [];
const REVIEW_TREE_COLLAPSED_STORAGE_PREFIX = "pier.git.review.treeCollapsed:";

function readSource(params: unknown): GitReviewScope | null {
  if (!(params && typeof params === "object" && "source" in params)) {
    return null;
  }
  const parsed = gitReviewScopeSchema.safeParse(params.source);
  return parsed.success ? parsed.data : null;
}

function useDockviewPanelVisible(api: IDockviewPanelProps["api"]): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const visible = api.onDidVisibilityChange(listener);
      return () => visible.dispose();
    },
    [api]
  );
  const getSnapshot = useCallback(() => api.isVisible, [api]);
  // 单测 harness 默认可见；SSR/缺省快照也按可见处理。
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/**
 * Shell 在 panel 存活期始终挂载：
 * - 同组切 tab（hidden）：只卸载 Body，session 保留
 * - 关闭 panel：dockview onDidRemovePanel 回收 session
 */
export function createGitChangesPanel(context: RendererPluginContext) {
  return function GitChangesPanel(props: IDockviewPanelProps) {
    const source = useMemo(() => readSource(props.params), [props.params]);
    const sourceKey = source ? JSON.stringify(source) : null;
    const visible = useDockviewPanelVisible(props.api);
    const panelId = props.api.id;

    useEffect(() => {
      if (!sourceKey) {
        return;
      }
      const containerApi = props.containerApi;
      if (
        !(
          containerApi &&
          typeof containerApi === "object" &&
          "onDidRemovePanel" in containerApi &&
          typeof containerApi.onDidRemovePanel === "function"
        )
      ) {
        return;
      }
      const disposable = containerApi.onDidRemovePanel(
        (panel: { id?: string }) => {
          if (panel?.id === panelId) {
            clearReviewSession(sourceKey);
          }
        }
      );
      return () => {
        if (
          disposable &&
          typeof disposable === "object" &&
          "dispose" in disposable &&
          typeof disposable.dispose === "function"
        ) {
          disposable.dispose();
        }
      };
    }, [panelId, props.containerApi, sourceKey]);

    if (!visible) {
      return null;
    }

    return (
      <GitChangesPanelBody
        context={context}
        source={source}
        sourceKey={sourceKey}
      />
    );
  };
}

function GitChangesPanelBody({
  context,
  source,
  sourceKey,
}: {
  readonly context: RendererPluginContext;
  readonly source: GitReviewScope | null;
  readonly sourceKey: string | null;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = usePanelSidebarCollapsed(
    REVIEW_TREE_COLLAPSED_STORAGE_PREFIX,
    source?.gitRootPath ?? null
  );
  const indexLoaderRef = useRef<GitReviewIndexLoader | null>(null);
  const [boundState, setBoundState] = useState<{
    readonly snapshot: GitReviewIndexLoaderSnapshot;
    readonly sourceKey: string | null;
  }>(() => {
    if (!sourceKey) {
      return { snapshot: { kind: "loading" }, sourceKey };
    }
    const session = readReviewSession(sourceKey);
    return {
      snapshot: session?.index ?? { kind: "loading" },
      sourceKey,
    };
  });
  const state = ((): GitReviewIndexLoaderSnapshot => {
    if (boundState.sourceKey === sourceKey) {
      if (boundState.snapshot.kind !== "loading") {
        return boundState.snapshot;
      }
      if (sourceKey) {
        return readReviewSession(sourceKey)?.index ?? boundState.snapshot;
      }
      return boundState.snapshot;
    }
    if (!sourceKey) {
      return { kind: "loading" };
    }
    return readReviewSession(sourceKey)?.index ?? { kind: "loading" };
  })();
  const entries =
    state.kind === "loaded" ? state.result.entries : EMPTY_REVIEW_ENTRIES;
  const language = context.i18n.language();
  // language 驱动文案；context 在 panel 生命周期内稳定。
  // biome-ignore lint/correctness/useExhaustiveDependencies: panel context is stable for the factory instance
  const collidingFileLabel = useMemo(() => {
    const labelLanguage = language;
    return (name: string) => {
      return pluginText(
        context,
        "reviewFilePathCollision",
        "File change · {{name}}",
        // language 让 memo 依赖显式化；翻译器忽略模板未引用的值。
        { language: labelLanguage, name }
      );
    };
  }, [language]);
  const treeModel = useMemo(
    () => gitReviewTreeModel(entries, collidingFileLabel),
    [collidingFileLabel, entries]
  );

  // index loader 只随 source 重建；git facade 随 context 稳定。
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation lifecycle is source-driven
  useEffect(() => {
    if (!source) {
      return;
    }
    preloadReviewCodeView();
    const loader = new GitReviewIndexLoader({
      cancel: (operationId) => context.git.cancelReviewRequest({ operationId }),
      load: (operationId) =>
        context.git.getReviewIndex({ operationId, source }),
      watch: (listener, onStartFailure, onReady) =>
        context.git.watch(
          source.gitRootPath,
          listener,
          onStartFailure,
          onReady
        ),
    });
    indexLoaderRef.current = loader;
    const sync = () => {
      const snapshot = loader.getSnapshot();
      if (snapshot.kind === "loaded" && sourceKey) {
        patchReviewSession(sourceKey, { index: snapshot });
      }
      setBoundState((prev) => {
        if (snapshot.kind === "loading") {
          let retained: GitReviewIndexLoaderSnapshot | null = null;
          if (prev.sourceKey === sourceKey && prev.snapshot.kind === "loaded") {
            retained = prev.snapshot;
          } else if (sourceKey) {
            retained = readReviewSession(sourceKey)?.index ?? null;
          }
          if (retained) {
            return { snapshot: retained, sourceKey };
          }
        }
        return { snapshot, sourceKey };
      });
    };
    const unsubscribe = loader.subscribe(sync);
    sync();
    return () => {
      const finalSnapshot = loader.getSnapshot();
      if (finalSnapshot.kind === "loaded" && sourceKey) {
        patchReviewSession(sourceKey, { index: finalSnapshot });
      }
      unsubscribe();
      loader.dispose();
      if (indexLoaderRef.current === loader) {
        indexLoaderRef.current = null;
      }
    };
  }, [source, sourceKey]);

  if (!source) {
    return (
      <GitReviewPanelLayout
        context={context}
        gitRootPath={null}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
      >
        <Alert className="m-3" variant="destructive">
          <AlertTitle>
            {pluginText(context, "reviewInvalidSource", "Invalid Git source")}
          </AlertTitle>
        </Alert>
      </GitReviewPanelLayout>
    );
  }
  if (state.kind === "loading") {
    return (
      <GitReviewPanelLayout
        context={context}
        gitRootPath={source.gitRootPath}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
      >
        <ReviewLoading context={context} />
      </GitReviewPanelLayout>
    );
  }
  if (state.kind === "error") {
    return (
      <GitReviewPanelLayout
        context={context}
        gitRootPath={source.gitRootPath}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
      >
        <ReviewFeedback
          context={context}
          failures={[]}
          indexFailure={state.failure}
          indexFailureTitle={pluginText(
            context,
            "reviewLoadFailed",
            "Failed to load changes"
          )}
          onRetryIndex={() => indexLoaderRef.current?.retry()}
          runtimeError={null}
        />
      </GitReviewPanelLayout>
    );
  }
  if (state.result.entries.length > 0) {
    return (
      <div aria-busy={state.refreshing || undefined} className="h-full min-h-0">
        <ReviewDocuments
          context={context}
          entries={state.result.entries}
          indexGeneration={state.generation}
          indexRefreshFailure={state.refreshFailure}
          onRetryIndex={() => indexLoaderRef.current?.retry()}
          scope={source}
          setSidebarCollapsed={setSidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
          treeModel={treeModel}
          warnings={state.result.warnings}
        />
      </div>
    );
  }
  return (
    <GitReviewPanelLayout
      context={context}
      gitRootPath={source.gitRootPath}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
    >
      <div
        aria-busy={state.refreshing || undefined}
        className="flex h-full min-h-0 flex-col bg-background"
      >
        <ReviewFeedback
          context={context}
          failures={[]}
          indexFailure={state.refreshFailure}
          onRetryIndex={() => indexLoaderRef.current?.retry()}
          runtimeError={null}
        />
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>
              {pluginText(context, "reviewEmptyTitle", "No changes")}
            </EmptyTitle>
            <EmptyDescription>
              {pluginText(
                context,
                "reviewEmptyDescription",
                "The working tree has no staged or unstaged changes."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </GitReviewPanelLayout>
  );
}
