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
  GIT_REVIEW_STATUS_PRIORITY,
  type GitReviewIndexEntry,
  type GitReviewScope,
  type GitReviewTarget,
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
import { GitCommitForm } from "./git-commit-form.tsx";
import { pluginText } from "./git-plugin-text.ts";
import { preloadReviewCodeView } from "./git-review-code-view.tsx";
import { ReviewDocuments } from "./git-review-content.tsx";
import {
  ReviewErrorEmpty,
  ReviewFailureEmpty,
  ReviewFeedback,
  ReviewLoading,
} from "./git-review-feedback.tsx";
import {
  GitReviewIndexLoader,
  type GitReviewIndexLoaderSnapshot,
} from "./git-review-index-loader.ts";
import { GitReviewPanelLayout } from "./git-review-panel-layout.tsx";
import {
  DEFAULT_UNCOMMITTED_FILTER,
  GitReviewScopeSwitcher,
  type GitReviewUncommittedFilter,
} from "./git-review-scope-switcher.tsx";
import {
  clearReviewSession,
  patchReviewSession,
  readReviewSession,
} from "./git-review-session-cache.ts";
import { gitReviewTreeModel } from "./git-review-tree.tsx";

const EMPTY_REVIEW_ENTRIES: readonly GitReviewIndexEntry[] = [];
const REVIEW_TREE_COLLAPSED_STORAGE_PREFIX = "pier.git.review.treeCollapsed:";

/** loading/error/空态下侧栏树为空,打开路径无目标可导航。 */
function noopOpenPath(_path: string): void {
  // 空树没有可打开的条目
}

/**
 * uncommitted scope 的未暂存/已暂存过滤(对齐 loomdesk includeUnstaged/
 * includeStaged):纯 renderer 投影过滤,conflict 分组不受过滤影响。
 */
function filterUncommittedEntries(
  entries: readonly GitReviewIndexEntry[],
  filter: GitReviewUncommittedFilter
): readonly GitReviewIndexEntry[] {
  if (filter.staged && filter.unstaged) {
    return entries;
  }
  const filtered: GitReviewIndexEntry[] = [];
  for (const entry of entries) {
    const renderSlots = entry.renderSlots.filter((slot) => {
      if (slot.group === "staged") {
        return filter.staged;
      }
      if (slot.group === "unstaged") {
        return filter.unstaged;
      }
      return true;
    });
    if (renderSlots.length === 0) {
      continue;
    }
    if (renderSlots.length === entry.renderSlots.length) {
      filtered.push(entry);
      continue;
    }
    // 契约不变式:entry.status 必须等于剩余 slot 的最高优先级状态。
    const status =
      GIT_REVIEW_STATUS_PRIORITY.find((candidate) =>
        renderSlots.some((slot) => slot.status === candidate)
      ) ?? entry.status;
    filtered.push({ ...entry, renderSlots, status });
  }
  return filtered;
}

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
        onSelectTarget={(target) => {
          if (!source) {
            return;
          }
          props.api.updateParameters({
            source: { ...source, target } satisfies GitReviewScope,
          });
        }}
        panelId={panelId}
        source={source}
        sourceKey={sourceKey}
      />
    );
  };
}

function GitChangesPanelBody({
  context,
  onSelectTarget,
  panelId,
  source,
  sourceKey,
}: {
  readonly context: RendererPluginContext;
  readonly onSelectTarget: (target: GitReviewTarget) => void;
  readonly panelId: string;
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
  const [uncommittedFilter, setUncommittedFilter] = useState(
    DEFAULT_UNCOMMITTED_FILTER
  );
  const visibleEntries = useMemo(
    () =>
      source?.target.kind === "uncommitted"
        ? filterUncommittedEntries(entries, uncommittedFilter)
        : entries,
    [entries, source?.target.kind, uncommittedFilter]
  );
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
    () => gitReviewTreeModel(visibleEntries, collidingFileLabel),
    [collidingFileLabel, visibleEntries]
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

  const scopeSwitcher = source ? (
    <GitReviewScopeSwitcher
      context={context}
      gitRootPath={source.gitRootPath}
      onSelectTarget={onSelectTarget}
      onUncommittedFilterChange={setUncommittedFilter}
      target={source.target}
      uncommittedFilter={uncommittedFilter}
    />
  ) : undefined;
  const stagedCount =
    source?.target.kind === "uncommitted"
      ? entries.filter((entry) =>
          entry.renderSlots.some((slot) => slot.group === "staged")
        ).length
      : 0;
  const commitForm =
    source && stagedCount > 0 ? (
      <GitCommitForm
        context={context}
        cwd={source.gitRootPath}
        stagedCount={stagedCount}
      />
    ) : undefined;

  if (!source) {
    return (
      <GitReviewPanelLayout
        context={context}
        gitRootPath={null}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
      >
        <ReviewErrorEmpty
          context={context}
          title={pluginText(
            context,
            "reviewInvalidSource",
            "Invalid Git source"
          )}
        />
      </GitReviewPanelLayout>
    );
  }
  if (state.kind === "loading") {
    return (
      <GitReviewPanelLayout
        context={context}
        contextId={source.contextId}
        gitRootPath={source.gitRootPath}
        headerLeading={scopeSwitcher}
        onOpenPath={noopOpenPath}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        treeModel={treeModel}
      >
        <ReviewLoading context={context} />
      </GitReviewPanelLayout>
    );
  }
  if (state.kind === "error") {
    return (
      <GitReviewPanelLayout
        context={context}
        contextId={source.contextId}
        gitRootPath={source.gitRootPath}
        headerLeading={scopeSwitcher}
        onOpenPath={noopOpenPath}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        treeModel={treeModel}
      >
        <ReviewFailureEmpty
          context={context}
          failure={state.failure}
          onRetry={() => indexLoaderRef.current?.retry()}
          title={pluginText(
            context,
            "reviewLoadFailed",
            "Failed to load changes"
          )}
        />
      </GitReviewPanelLayout>
    );
  }
  if (visibleEntries.length > 0) {
    return (
      <div aria-busy={state.refreshing || undefined} className="h-full min-h-0">
        <ReviewDocuments
          context={context}
          entries={visibleEntries}
          headerLeading={scopeSwitcher}
          indexGeneration={state.generation}
          indexRefreshFailure={state.refreshFailure}
          indexRefreshing={state.refreshing}
          onRetryIndex={() => indexLoaderRef.current?.retry()}
          panelId={panelId}
          scope={source}
          setSidebarCollapsed={setSidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
          sidebarFooter={commitForm}
          treeModel={treeModel}
          warnings={state.result.warnings}
        />
      </div>
    );
  }
  return (
    <GitReviewPanelLayout
      context={context}
      contextId={source.contextId}
      gitRootPath={source.gitRootPath}
      headerLeading={scopeSwitcher}
      onOpenPath={noopOpenPath}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      treeModel={treeModel}
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
        />
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>
              {pluginText(context, "reviewEmptyTitle", "No changes")}
            </EmptyTitle>
            <EmptyDescription>
              {entries.length > 0
                ? pluginText(
                    context,
                    "reviewEmptyDescriptionFiltered",
                    "All changes are hidden by the current filter."
                  )
                : emptyDescription(context, source.target)}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </GitReviewPanelLayout>
  );
}

function emptyDescription(
  context: RendererPluginContext,
  target: GitReviewTarget
): string {
  if (target.kind === "commit") {
    return pluginText(
      context,
      "reviewEmptyDescriptionCommit",
      "The selected commit has no file changes."
    );
  }
  if (target.kind === "branch") {
    return pluginText(
      context,
      "reviewEmptyDescriptionBranch",
      "The current branch has no changes relative to {{branch}}.",
      { branch: target.ref }
    );
  }
  return pluginText(
    context,
    "reviewEmptyDescription",
    "The working tree has no staged or unstaged changes."
  );
}
