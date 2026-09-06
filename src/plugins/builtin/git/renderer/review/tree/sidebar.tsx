import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { FileSearchBar } from "@pier/ui/file/search-bar.tsx";
import {
  getTreeExpansionAuthority,
  gitReviewTreeExpansionScopeId,
  PierFileTree,
} from "@pier/ui/file/tree.tsx";
import {
  bindTreeExpansionPersistence,
  hydrateTreeExpansion,
} from "@pier/ui/file/tree-expansion-persist.ts";
import { FILE_TREE_SEARCH_SHELL_CLASS } from "@pier/ui/file/tree-style.ts";
import type { FileTreeSearch } from "@pier/ui/file/use-tree-search.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { SearchX } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo } from "react";
import { pluginText } from "../../plugin-text.ts";
import { ReviewTreeLoading } from "../feedback.tsx";
import type { GitReviewTreeModel } from "../tree.tsx";
import { useGitReviewTreeContextMenu } from "../tree-context-menu.ts";
import { revealGitReviewTreeSelection } from "../tree-reveal-selection.ts";

const REVIEW_TREE_EXPANSION_STORAGE_PREFIX =
  "pier.git.review.tree.expansion.v1:";

function GitReviewTreeSidebarComponent({
  context,
  contextId,
  gitRootPath,
  mutationAuthorityBlocked,
  onOpenPath,
  isActiveOpenPath,
  onContextMenuSession,
  sidebarFooter,
  sidebarHeader,
  sourcePanelId,
  treeLoading,
  treeSearch,
  treeModel,
}: {
  context: RendererPluginContext;
  contextId: string;
  gitRootPath: string;
  mutationAuthorityBlocked: boolean;
  onOpenPath: (path: string) => void;
  isActiveOpenPath?: (path: string) => boolean;
  onContextMenuSession?: (
    phase: "begin" | "end",
    detail: {
      readonly intent: "inspect" | "command";
      readonly path: string;
    }
  ) => void;
  sidebarFooter?: ReactNode;
  sidebarHeader?: ReactNode;
  sourcePanelId?: string;
  treeLoading?: boolean;
  treeSearch: FileTreeSearch;
  treeModel: GitReviewTreeModel;
}) {
  const openItemContextMenu = useGitReviewTreeContextMenu({
    context,
    contextId,
    gitRootPath,
    mutationAuthorityBlocked,
    ...(sourcePanelId ? { sourcePanelId } : {}),
    treeModel,
  });
  const expansionAuthority = useMemo(
    () =>
      getTreeExpansionAuthority(
        gitReviewTreeExpansionScopeId(contextId, gitRootPath)
      ),
    [contextId, gitRootPath]
  );
  hydrateTreeExpansion(
    REVIEW_TREE_EXPANSION_STORAGE_PREFIX.concat(expansionAuthority.scopeId),
    expansionAuthority
  );
  useEffect(
    () =>
      bindTreeExpansionPersistence(
        REVIEW_TREE_EXPANSION_STORAGE_PREFIX.concat(expansionAuthority.scopeId),
        expansionAuthority
      ),
    [expansionAuthority]
  );
  const hasQuery = treeSearch.value.trim().length > 0;
  const searchHasNoResults =
    treeSearch.open &&
    hasQuery &&
    treeSearch.queryApplied &&
    treeSearch.matchCount === 0;
  const searchActionsDisabled = treeSearch.matchCount === 0;
  const handleOpenPath = useCallback(
    (path: string) => {
      onOpenPath(path);
      revealGitReviewTreeSelection(
        treeSearch.treeApiRef.current,
        path,
        treeSearch.open ? { preserveFocus: true } : undefined
      );
    },
    [onOpenPath, treeSearch.open, treeSearch.treeApiRef]
  );

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      {sidebarHeader ?? null}
      {treeSearch.open ? (
        <div className={FILE_TREE_SEARCH_SHELL_CLASS}>
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
        {treeLoading === true ? (
          <ReviewTreeLoading context={context} />
        ) : (
          <PierFileTree
            className="min-h-0 w-full flex-1"
            expansionAuthority={expansionAuthority}
            expansionSeed="file-ancestors"
            flattenEmptyDirectories
            flattenMinDepth={2}
            items={treeModel.items}
            label={pluginText(context, "reviewTreeLabel", "Changed files")}
            onOpenItemContextMenu={openItemContextMenu}
            onOpenPath={handleOpenPath}
            {...(isActiveOpenPath ? { isActiveOpenPath } : {})}
            {...(onContextMenuSession ? { onContextMenuSession } : {})}
            onSearchMatchStateChange={treeSearch.updateMatchState}
            stickyFolders
            treeApiRef={treeSearch.treeApiRef}
          />
        )}
        {searchHasNoResults && treeLoading !== true ? (
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

export const GitReviewTreeSidebar = memo(GitReviewTreeSidebarComponent);
