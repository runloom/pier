import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { usePanelSidebarCollapsed } from "@pier/ui/use-panel-sidebar-preference.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type {
  GitReviewScope,
  GitReviewTarget,
} from "@shared/contracts/git/review.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM,
  gitChangesPanelTitle,
} from "./changes-tab-title.ts";
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
import {
  readGitReviewScope,
  readPendingReveal,
} from "./review/pending-reveal-params.ts";
import { GitReviewScopeSwitcher } from "./review/scope-switcher.tsx";
import { clearReviewSessionsForScope } from "./review/session-cache.ts";
import type { PendingCommentReveal } from "./review/surface-types.ts";
import { ReviewDocuments } from "./review/surfaces.tsx";
import { gitReviewTreeModel } from "./review/tree.tsx";
import { REVIEW_TREE_COLLAPSED_STORAGE_PREFIX } from "./review/tree-sidebar-preference.ts";
import { planTabChangeSummaryWrite } from "./tab-change-summary-sync.ts";
import { usePluginLanguage } from "./use-plugin-language.ts";

/** loading/error/空态下侧栏树为空,打开路径无目标可导航。 */
function noopOpenPath(_path: string): void {
  // 空树没有可打开的条目
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
    const source = useMemo(
      () => readGitReviewScope(props.params),
      [props.params]
    );
    const pendingReveal = useMemo(
      () => readPendingReveal(props.params),
      [props.params]
    );
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
            // 与 source 同一次写清空摘要，避免新标题 + 旧 +/− 同帧。
            props.api.updateParameters({
              source: { ...source, target } satisfies GitReviewScope,
              [GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM]: null,
            });
          }}
          panelApi={props.api}
          panelId={panelId}
          panelParams={props.params}
          pendingReveal={pendingReveal}
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
  panelApi,
  panelId,
  panelParams,
  pendingReveal,
  source,
  sourceKey,
  visible,
}: {
  readonly authority: GitReviewMutationAuthority;
  readonly context: RendererPluginContext;
  readonly onSelectTarget: (target: GitReviewTarget) => void;
  readonly panelApi: IDockviewPanelProps["api"];
  readonly panelId: string;
  readonly panelParams: IDockviewPanelProps["params"];
  readonly pendingReveal: PendingCommentReveal | null;
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

  // index 就绪后写 scope 级 +/−；sourceKey 变化时 layout 前清空（useLayoutEffect）。
  // tabChangeSummary 为短暂呈现态，layout 落盘会 strip（strip-ephemeral-layout-params）。
  const lastTabSummarySourceKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const paramsRecord =
      panelParams && typeof panelParams === "object"
        ? (panelParams as Record<string, unknown>)
        : {};
    const current = paramsRecord[GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM];
    let planState: Parameters<typeof planTabChangeSummaryWrite>[0]["state"];
    if (state.kind === "loaded") {
      planState = { kind: "loaded", result: state.result };
    } else if (state.kind === "error") {
      planState = { kind: "error" };
    } else {
      planState = { kind: "loading" };
    }
    const { nextLastSourceKey, plan } = planTabChangeSummaryWrite({
      currentParam: current,
      lastSourceKey: lastTabSummarySourceKeyRef.current,
      source,
      sourceKey,
      state: planState,
    });
    lastTabSummarySourceKeyRef.current = nextLastSourceKey;
    if (plan.action === "write") {
      panelApi.updateParameters({
        [GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM]: plan.summary,
      });
    }
  }, [panelApi, panelParams, source, sourceKey, state]);
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
      // commit / branch scope: industry uses "Changed files" (GitHub / JetBrains),
      // not a bare "Files" folder that collides with the Files panel product name.
      committed: pluginText(
        context,
        "reviewTreeGroupCommitted",
        "Changed Files",
        { language: labelLanguage }
      ),
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

  const handlePendingRevealHandled = useCallback(() => {
    // Consume jump intent so layout restore / re-open won't re-fire.
    panelApi.updateParameters({ pendingReveal: null });
  }, [panelApi]);

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
    // index 失败时 entries 恒为空：与成功空态一致，不传树 props（无空侧栏）。
    return (
      <GitReviewPanelLayout
        context={context}
        contextId={source.contextId}
        gitRootPath={source.gitRootPath}
        headerLeading={scopeSwitcher}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
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
          onPendingRevealHandled={handlePendingRevealHandled}
          onRetryIndex={retryIndex}
          panelId={panelId}
          panelVisible={visible}
          pendingReveal={pendingReveal}
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
  // 无变更：不挂树侧栏（避免空目录树黑区）；主区 Empty 为唯一占位。
  return (
    <GitReviewPanelLayout
      context={context}
      contextId={source.contextId}
      gitRootPath={source.gitRootPath}
      headerLeading={scopeSwitcher}
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
