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
import { useEffect, useMemo, useRef, useState } from "react";
import { pluginText } from "./git-plugin-text.ts";
import { preloadReviewCodeView } from "./git-review-code-view.tsx";
import { ReviewDocuments } from "./git-review-content.tsx";
import { ReviewFeedback, ReviewLoading } from "./git-review-feedback.tsx";
import {
  GitReviewIndexLoader,
  type GitReviewIndexLoaderSnapshot,
} from "./git-review-index-loader.ts";
import { GitReviewPanelLayout } from "./git-review-panel-layout.tsx";
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

export function createGitChangesPanel(context: RendererPluginContext) {
  return function GitChangesPanel(props: IDockviewPanelProps) {
    const source = useMemo(() => readSource(props.params), [props.params]);
    const sourceKey = source ? JSON.stringify(source) : null;
    const [sidebarCollapsed, setSidebarCollapsed] = usePanelSidebarCollapsed(
      REVIEW_TREE_COLLAPSED_STORAGE_PREFIX,
      source?.gitRootPath ?? null
    );
    const indexLoaderRef = useRef<GitReviewIndexLoader | null>(null);
    const [boundState, setBoundState] = useState<{
      readonly snapshot: GitReviewIndexLoaderSnapshot;
      readonly sourceKey: string | null;
    }>({
      snapshot: { kind: "loading" },
      sourceKey,
    });
    const state =
      boundState.sourceKey === sourceKey
        ? boundState.snapshot
        : ({ kind: "loading" } as const);
    const entries =
      state.kind === "loaded" ? state.result.entries : EMPTY_REVIEW_ENTRIES;
    const language = context.i18n.language();
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

    useEffect(() => {
      if (!source) {
        return;
      }
      preloadReviewCodeView();
      setBoundState({ snapshot: { kind: "loading" }, sourceKey });
      const loader = new GitReviewIndexLoader({
        cancel: (operationId) =>
          context.git.cancelReviewRequest({ operationId }),
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
      const sync = () =>
        setBoundState({ snapshot: loader.getSnapshot(), sourceKey });
      const unsubscribe = loader.subscribe(sync);
      sync();
      return () => {
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
        <div
          aria-busy={state.refreshing || undefined}
          className="h-full min-h-0"
        >
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
  };
}
