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
  type GitReviewScope,
  type GitReviewTarget,
  gitReviewScopeSchema,
} from "@shared/contracts/git/review.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { gitChangesPanelTitle } from "./changes-tab-title.ts";
import { useGitChangesPanelIndexState } from "./hooks/use-changes-panel-index-state.ts";
import { pluginText } from "./plugin-text.ts";
import {
  ReviewErrorEmpty,
  ReviewFailureEmpty,
  ReviewFeedback,
  ReviewLoading,
} from "./review/feedback.tsx";
import { GitReviewMutationAuthority } from "./review/mutation-authority.ts";
import { GitReviewPanelLayout } from "./review/panel-layout.tsx";
import { GitReviewScopeSwitcher } from "./review/scope-switcher.tsx";
import { clearReviewSessionsForScope } from "./review/session-cache.ts";
import { ReviewDocuments } from "./review/surfaces.tsx";
import { gitReviewTreeModel } from "./review/tree.tsx";
import { usePluginLanguage } from "./use-plugin-language.ts";

const REVIEW_TREE_COLLAPSED_STORAGE_PREFIX = "pier.git.review.treeCollapsed:";

/** loading/error/空态下侧栏树为空,打开路径无目标可导航。 */
function noopOpenPath(_path: string): void {
  // 空树没有可打开的条目
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
 * - 同组切 tab（hidden）：保留 Body 与三个阅读面实例，停止非活动交互
 * - 关闭 panel：dockview onDidRemovePanel 回收 session
 */
export function createGitChangesPanel(
  context: RendererPluginContext,
  authority = new GitReviewMutationAuthority()
) {
  return function GitChangesPanel(props: IDockviewPanelProps) {
    const source = useMemo(() => readSource(props.params), [props.params]);
    const sourceKey = source ? JSON.stringify(source) : null;
    const visible = useDockviewPanelVisible(props.api);
    const panelId = props.api.id;

    // Scope / 路径变化时同步 tab 标题（含 layout 恢复后纠正旧「变更」标题）。
    useEffect(() => {
      if (!source) {
        return;
      }
      const nextTitle = gitChangesPanelTitle(source);
      if (props.api.title !== nextTitle) {
        props.api.setTitle(nextTitle);
      }
    }, [props.api, source]);

    useEffect(() => {
      if (!(source && sourceKey)) {
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
            clearReviewSessionsForScope(source);
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
    }, [panelId, props.containerApi, source, sourceKey]);

    return (
      <div
        aria-hidden={!visible}
        className="h-full min-h-0"
        inert={visible ? undefined : true}
      >
        <GitChangesPanelBody
          authority={authority}
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
          visible={visible}
        />
      </div>
    );
  };
}

function GitChangesPanelBody({
  authority,
  context,
  onSelectTarget,
  panelId,
  source,
  sourceKey,
  visible,
}: {
  readonly authority: GitReviewMutationAuthority;
  readonly context: RendererPluginContext;
  readonly onSelectTarget: (target: GitReviewTarget) => void;
  readonly panelId: string;
  readonly source: GitReviewScope | null;
  readonly sourceKey: string | null;
  readonly visible: boolean;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = usePanelSidebarCollapsed(
    REVIEW_TREE_COLLAPSED_STORAGE_PREFIX,
    source?.gitRootPath ?? null
  );
  const [targetSelectionSourceKey, setTargetSelectionSourceKey] = useState<
    string | null
  >(null);
  // sourceKey 切走后丢弃挂起标记，避免同一 key 被恢复时误进无限 loading。
  useEffect(() => {
    if (
      targetSelectionSourceKey !== null &&
      targetSelectionSourceKey !== sourceKey
    ) {
      setTargetSelectionSourceKey(null);
    }
  }, [sourceKey, targetSelectionSourceKey]);
  const targetSelectionPending =
    sourceKey !== null && targetSelectionSourceKey === sourceKey;
  const onTargetSelectionPendingChange = useCallback(
    (pending: boolean) => {
      setTargetSelectionSourceKey(pending ? sourceKey : null);
    },
    [sourceKey]
  );
  const {
    acquireMutationAuthority,
    entries,
    mutationAuthorityBlocked,
    retryIndex,
    state,
    waitForAuthoritativeIndex,
  } = useGitChangesPanelIndexState({ authority, context, source, sourceKey });
  const language = usePluginLanguage();
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: panel context is stable for the factory instance
  const treeGroupLabels = useMemo(() => {
    const labelLanguage = language;
    return {
      conflict: pluginText(
        context,
        "reviewTreeGroupConflict",
        "Merge Changes",
        { language: labelLanguage }
      ),
      staged: pluginText(context, "reviewTreeGroupStaged", "Staged Changes", {
        language: labelLanguage,
      }),
      unstaged: pluginText(context, "reviewTreeGroupUnstaged", "Changes", {
        language: labelLanguage,
      }),
    };
  }, [language]);
  const treeModel = useMemo(
    () =>
      gitReviewTreeModel(entries, collidingFileLabel, treeGroupLabels, {
        expectedIndexRevision:
          state.kind === "loaded" ? (state.result.indexRevision ?? null) : null,
        uncommitted: source?.target.kind === "uncommitted",
      }),
    [collidingFileLabel, entries, source?.target.kind, state, treeGroupLabels]
  );

  const scopeSwitcher = source ? (
    <GitReviewScopeSwitcher
      context={context}
      gitRootPath={source.gitRootPath}
      onSelectTarget={onSelectTarget}
      onTargetSelectionPendingChange={onTargetSelectionPendingChange}
      target={source.target}
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
  // index 冷加载：正文 + 侧栏树都走骨架（树条用 foreground 淡色，sidebar 底≠muted）
  if (state.kind === "loading") {
    return (
      <GitReviewPanelLayout
        context={context}
        contextId={source.contextId}
        gitRootPath={source.gitRootPath}
        headerLeading={scopeSwitcher}
        onOpenPath={noopOpenPath}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={false}
        treeLoading
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
          onRetry={retryIndex}
          title={pluginText(
            context,
            "reviewLoadFailed",
            "Failed to load changes"
          )}
        />
      </GitReviewPanelLayout>
    );
  }
  if (entries.length > 0) {
    return (
      <div aria-busy={state.refreshing || undefined} className="h-full min-h-0">
        <ReviewDocuments
          context={context}
          entries={entries}
          groupSummaries={state.result.groupSummaries}
          headerLeading={scopeSwitcher}
          indexGeneration={state.generation}
          indexRefreshFailure={state.refreshFailure}
          indexRefreshing={state.refreshing}
          key={sourceKey}
          mutationAuthorityBlocked={mutationAuthorityBlocked}
          onAcquireMutationAuthority={acquireMutationAuthority}
          onMutationCommitted={waitForAuthoritativeIndex}
          onRetryIndex={retryIndex}
          panelId={panelId}
          panelVisible={visible}
          scope={source}
          setSidebarCollapsed={setSidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
          targetSelectionPending={targetSelectionPending}
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
          onRetryIndex={retryIndex}
        />
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>
              {pluginText(context, "reviewEmptyTitle", "No changes")}
            </EmptyTitle>
            <EmptyDescription>
              {emptyDescription(context, source.target)}
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
