import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
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
import { memo, type ReactNode } from "react";
import { pluginText } from "./git-plugin-text.ts";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";
import { useGitReviewTreeContextMenu } from "./git-review-tree-context-menu.ts";

const REVIEW_TREE_WIDTH_STORAGE_KEY = "pier.git.review.treeWidthPx";

function GitReviewTreeSidebarComponent({
  context,
  contextId,
  gitRootPath,
  onOpenPath,
  revealPath,
  sidebarFooter,
  sourcePanelId,
  treeSearch,
  treeModel,
}: {
  context: RendererPluginContext;
  contextId: string;
  gitRootPath: string;
  onOpenPath: (path: string) => void;
  revealPath: string | null;
  sidebarFooter?: ReactNode;
  sourcePanelId?: string;
  treeSearch: ReturnType<typeof useFileTreeSearch>;
  treeModel: ReturnType<typeof gitReviewTreeModel>;
}) {
  const openItemContextMenu = useGitReviewTreeContextMenu({
    context,
    contextId,
    gitRootPath,
    ...(sourcePanelId ? { sourcePanelId } : {}),
    treeModel,
  });
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
        <div className="shrink-0 px-2 py-1">
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
          flattenEmptyDirectories
          flattenMinDepth={2}
          items={treeModel.items}
          label={pluginText(context, "reviewTreeLabel", "Changed files")}
          onOpenItemContextMenu={openItemContextMenu}
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
              <EmptyTitle>
                {pluginText(
                  context,
                  "reviewTreeNoSearchResultsTitle",
                  "No matching changes"
                )}
              </EmptyTitle>
              <EmptyDescription>
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
      {sidebarFooter ?? null}
    </aside>
  );
}

const GitReviewTreeSidebar = memo(GitReviewTreeSidebarComponent);

export function GitReviewPanelLayout({
  children,
  context,
  contextId,
  gitRootPath,
  headerLeading,
  headerTrailing,
  onOpenPath,
  selectedTreePath,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  sourcePanelId,
  treeModel,
}: {
  children: ReactNode;
  context: RendererPluginContext;
  contextId?: string | null;
  gitRootPath: string | null;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  onOpenPath?: (path: string) => void;
  selectedTreePath?: string | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  sidebarFooter?: ReactNode;
  sourcePanelId?: string;
  treeModel?: ReturnType<typeof gitReviewTreeModel> | null;
}) {
  const treeSearch = useFileTreeSearch();
  const hasTree = Boolean(treeModel && onOpenPath);

  const toggleSearch = () => {
    if (!hasTree) {
      return;
    }
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      treeSearch.openSearch();
      return;
    }
    treeSearch.toggleSearch();
  };
  const collapseSidebar = () => {
    treeSearch.closeSearch();
    setSidebarCollapsed(true);
  };
  const sidebar =
    hasTree &&
    !sidebarCollapsed &&
    treeModel &&
    onOpenPath &&
    gitRootPath &&
    contextId ? (
      <GitReviewTreeSidebar
        context={context}
        contextId={contextId}
        gitRootPath={gitRootPath}
        onOpenPath={onOpenPath}
        revealPath={selectedTreePath ?? null}
        {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
        {...(sourcePanelId ? { sourcePanelId } : {})}
        treeModel={treeModel}
        treeSearch={treeSearch}
      />
    ) : null;

  return (
    <FilePanelLayout
      contentPanelId="git-review-diff"
      header={
        <FilePanelHeader
          center={null}
          {...(headerTrailing === undefined
            ? {}
            : { trailing: headerTrailing })}
          leading={
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
                onOpenSearch={toggleSearch}
              />
              {headerLeading}
            </>
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
