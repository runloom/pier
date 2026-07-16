import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  FilePanelBreadcrumb,
  FilePanelHeader,
  FilePanelLayout,
  FilePanelSearchButton,
  FilePanelSidebarToggleButton,
} from "@pier/ui/file-panel-layout.tsx";
import { FileSearchBar } from "@pier/ui/file-search-bar.tsx";
import { PierFileTree } from "@pier/ui/file-tree.tsx";
import { useFileTreeSearch } from "@pier/ui/use-file-tree-search.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { SearchX } from "lucide-react";
import { memo, type ReactNode, useMemo } from "react";
import { pluginText } from "./git-plugin-text.ts";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";

const REVIEW_TREE_WIDTH_STORAGE_KEY = "pier.git.review.treeWidthPx";

function projectNameFromRoot(root: string): string {
  return root.split("/").filter(Boolean).at(-1) ?? root;
}

function GitReviewTreeSidebarComponent({
  context,
  onOpenPath,
  revealPath,
  treeSearch,
  treeModel,
}: {
  context: RendererPluginContext;
  onOpenPath: (path: string) => void;
  revealPath: string | null;
  treeSearch: ReturnType<typeof useFileTreeSearch>;
  treeModel: ReturnType<typeof gitReviewTreeModel>;
}) {
  const hasQuery = treeSearch.value.trim().length > 0;
  const searchHasNoResults =
    treeSearch.open &&
    hasQuery &&
    treeSearch.queryApplied &&
    treeSearch.matchCount === 0;
  const searchActionsDisabled = treeSearch.matchCount === 0;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      {treeSearch.open ? (
        <div className="shrink-0 px-2 pb-1.5">
          <FileSearchBar
            className="w-full"
            focusSignal={treeSearch.focusSignal}
            labels={{
              close: pluginText(context, "reviewTreeSearchClose", "Close"),
              next: pluginText(context, "reviewTreeSearchNext", "Next match"),
              open: pluginText(
                context,
                "reviewTreeSearchOpen",
                "Open selected change"
              ),
              placeholder: pluginText(
                context,
                "reviewTreeSearch",
                "Find in changed files"
              ),
              previous: pluginText(
                context,
                "reviewTreeSearchPrevious",
                "Previous match"
              ),
            }}
            matchAnnouncement={
              treeSearch.matchCount > 0
                ? pluginText(
                    context,
                    "reviewTreeSearchMatchAnnouncement",
                    "Matching changes: {{count}}",
                    { count: treeSearch.matchCount }
                  )
                : ""
            }
            matchText={hasQuery ? String(treeSearch.matchCount) : ""}
            navigationDisabled={searchActionsDisabled}
            onChange={treeSearch.changeSearch}
            onClose={treeSearch.closeSearch}
            onNavigate={treeSearch.navigateSearch}
            onSubmit={treeSearch.openFocusedMatch}
            submitDisabled={
              searchActionsDisabled || !treeSearch.focusedMatchOpenable
            }
            surface="sidebar"
            testId="git-review-tree-search-bar"
            value={treeSearch.value}
          />
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        <PierFileTree
          className="min-h-0 w-full flex-1"
          items={treeModel.items}
          label={pluginText(context, "reviewTreeLabel", "Changed files")}
          onOpenPath={onOpenPath}
          onSearchMatchStateChange={treeSearch.updateMatchState}
          revealPath={revealPath}
          stickyFolders
          treeApiRef={treeSearch.attachTreeApi}
        />
        {searchHasNoResults ? (
          <Empty
            aria-live="polite"
            className="absolute inset-0 z-10 min-h-0 rounded-none border-0 bg-sidebar/95 p-4"
            data-testid="git-review-tree-search-empty"
            role="status"
          >
            <EmptyHeader className="gap-1.5">
              <EmptyMedia className="mb-1" variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle className="text-sm">
                {pluginText(
                  context,
                  "reviewTreeNoSearchResultsTitle",
                  "No matching changes"
                )}
              </EmptyTitle>
              <EmptyDescription className="text-xs">
                {pluginText(
                  context,
                  "reviewTreeNoSearchResultsDescription",
                  "Try another file name or path."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </aside>
  );
}

const GitReviewTreeSidebar = memo(GitReviewTreeSidebarComponent);

export function GitReviewPanelLayout({
  children,
  context,
  gitRootPath,
  onOpenPath,
  selectedFilePath,
  selectedTreePath,
  setSidebarCollapsed,
  sidebarCollapsed,
  treeModel,
}: {
  children: ReactNode;
  context: RendererPluginContext;
  gitRootPath: string | null;
  onOpenPath?: (path: string) => void;
  selectedFilePath?: string | null;
  selectedTreePath?: string | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  treeModel?: ReturnType<typeof gitReviewTreeModel> | null;
}) {
  const treeSearch = useFileTreeSearch();
  const hasTree = Boolean(treeModel && onOpenPath);
  const projectName = gitRootPath
    ? projectNameFromRoot(gitRootPath)
    : pluginText(context, "reviewChangesTitle", "Changes");
  const breadcrumbSegments = useMemo(() => {
    if (selectedFilePath) {
      return [projectName, ...selectedFilePath.split("/").filter(Boolean)];
    }
    return gitRootPath
      ? [projectName, pluginText(context, "reviewChangesTitle", "Changes")]
      : [projectName];
  }, [context, gitRootPath, projectName, selectedFilePath]);

  const openSearch = () => {
    if (!hasTree) {
      return;
    }
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
    treeSearch.openSearch();
  };
  const collapseSidebar = () => {
    treeSearch.closeSearch();
    setSidebarCollapsed(true);
  };
  const sidebar =
    hasTree && !sidebarCollapsed && treeModel && onOpenPath ? (
      <GitReviewTreeSidebar
        context={context}
        onOpenPath={onOpenPath}
        revealPath={selectedTreePath ?? null}
        treeModel={treeModel}
        treeSearch={treeSearch}
      />
    ) : null;

  return (
    <FilePanelLayout
      contentPanelId="git-review-diff"
      header={
        <FilePanelHeader
          center={
            <FilePanelBreadcrumb
              ariaLabel={pluginText(
                context,
                "reviewBreadcrumbLabel",
                "Review location"
              )}
              segments={breadcrumbSegments}
            />
          }
          leading={
            hasTree ? (
              <>
                <FilePanelSidebarToggleButton
                  collapsed={sidebarCollapsed}
                  collapseLabel={pluginText(
                    context,
                    "reviewTreeCollapse",
                    "Collapse changed files"
                  )}
                  expandLabel={pluginText(
                    context,
                    "reviewTreeExpand",
                    "Expand changed files"
                  )}
                  onToggle={() => {
                    if (sidebarCollapsed) {
                      setSidebarCollapsed(false);
                    } else {
                      collapseSidebar();
                    }
                  }}
                />
                <FilePanelSearchButton
                  label={pluginText(
                    context,
                    "reviewTreeSearch",
                    "Find in changed files"
                  )}
                  onOpenSearch={openSearch}
                />
              </>
            ) : null
          }
        />
      }
      onSidebarAutoCollapse={collapseSidebar}
      sidebar={sidebar}
      sidebarPanelId="git-review-tree"
      sidebarWidthStorageKey={REVIEW_TREE_WIDTH_STORAGE_KEY}
    >
      {children}
    </FilePanelLayout>
  );
}
