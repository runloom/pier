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
  filePanelTreeToggleShortcutLabel,
} from "@pier/ui/file/panel-layout.tsx";
import { FileSearchBar } from "@pier/ui/file/search-bar.tsx";
import {
  getTreeExpansionAuthority,
  gitReviewTreeExpansionScopeId,
  PierFileTree,
} from "@pier/ui/file/tree.tsx";
import { bindTreeExpansionPersistence } from "@pier/ui/file/tree-expansion-persist.ts";
import { FILE_TREE_SEARCH_SHELL_CLASS } from "@pier/ui/file/tree-style.ts";
import type { PierFileTreeExpandAllOptions } from "@pier/ui/file/tree-types.ts";
import { useFileTreeSearch } from "@pier/ui/file/use-tree-search.tsx";

import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { SearchX } from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { pluginText } from "../plugin-text.ts";
import { ReviewTreeLoading } from "./feedback.tsx";
import type { ReviewTreeFocus } from "./surface-types.ts";
import type { gitReviewTreeModel } from "./tree.tsx";
import { registerGitReviewTreeFolderHandlers } from "./tree-collapse-registry.ts";
import { useGitReviewTreeContextMenu } from "./tree-context-menu.ts";
import { revealGitReviewTreeSelection } from "./tree-reveal-selection.ts";

const REVIEW_TREE_WIDTH_STORAGE_KEY = "pier.git.review.treeWidthPx";
const REVIEW_TREE_EXPANSION_STORAGE_PREFIX =
  "pier.git.review.tree.expansion.v1:";
/**
 * Review 树已全量投影，Expand Folders 用独立层数预算（勿直接复用 maxDepth 标识符）。
 * 与 absolute maxDepth 安全轨同数量级，避免默认 3 层只开浅目录。
 */
const GIT_REVIEW_TREE_EXPAND_ALL_MAX_LEVELS = 64;

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
  treeSearch: ReturnType<typeof useFileTreeSearch>;
  treeModel: ReturnType<typeof gitReviewTreeModel>;
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
  // 展开态跨重开面板 / 重启保留；未持久化时每次进 review 都要重新折叠一遍。
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

  // Explicit open: center the row in the tree viewport (sticky-aware via
  // PierFileTree reveal). Not continuous active tracking.
  const handleOpenPath = useCallback(
    (path: string) => {
      onOpenPath(path);
      revealGitReviewTreeSelection(treeSearch.treeApiRef.current, path);
    },
    [onOpenPath, treeSearch.treeApiRef]
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

const GitReviewTreeSidebar = memo(GitReviewTreeSidebarComponent);

export function GitReviewPanelLayout({
  children,
  context,
  contextId,
  gitRootPath,
  mutationAuthorityBlocked = false,
  headerCenter,
  headerLeading,
  headerTrailing,
  onOpenPath,
  isActiveOpenPath,
  onContextMenuSession,
  onContentResize,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  sidebarHeader,
  sourcePanelId,
  treeFocus = null,
  treeLoading = false,
  treeModel,
}: {
  children: ReactNode;
  context: RendererPluginContext;
  contextId?: string | null;
  gitRootPath: string | null;
  mutationAuthorityBlocked?: boolean;
  headerCenter?: ReactNode;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  onOpenPath?: (path: string) => void;
  isActiveOpenPath?: (path: string) => boolean;
  onContextMenuSession?: (
    phase: "begin" | "end",
    detail: {
      readonly intent: "inspect" | "command";
      readonly path: string;
    }
  ) => void;
  onContentResize?: (widthPx: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  sidebarFooter?: ReactNode;
  sidebarHeader?: ReactNode;
  sourcePanelId?: string;
  treeFocus?: ReviewTreeFocus | null;
  /** index 加载中：侧栏显示树骨架而非空 PierFileTree */
  treeLoading?: boolean;
  treeModel?: ReturnType<typeof gitReviewTreeModel> | null;
}) {
  const treeSearch = useFileTreeSearch();
  const lastRevealedNonceRef = useRef<number | null>(null);
  // 无变更时侧栏与树 chrome 一并隐藏，避免空树黑区；冷加载骨架仍占位。
  const treeHasContent =
    treeLoading === true || (treeModel != null && treeModel.items.length > 0);
  const hasTree = Boolean(treeHasContent && onOpenPath);

  // 依赖稳定 ref / callback，避免 treeSearch 对象每 render 换新导致 handler 空窗
  const treeApiRef = treeSearch.treeApiRef;
  const collapseAllFolders = treeSearch.collapseAllFolders;
  const expandAllFolders = treeSearch.expandAllFolders;
  useEffect(() => {
    if (!(hasTree && !sidebarCollapsed && treeLoading !== true)) {
      return;
    }
    const reviewExpandOptions = (
      rootPath?: string
    ): PierFileTreeExpandAllOptions =>
      rootPath
        ? {
            maxExpandLevels: GIT_REVIEW_TREE_EXPAND_ALL_MAX_LEVELS,
            rootPath,
          }
        : { maxExpandLevels: GIT_REVIEW_TREE_EXPAND_ALL_MAX_LEVELS };
    return registerGitReviewTreeFolderHandlers({
      collapseAll: (rootPath) => {
        const options = rootPath ? { rootPath } : undefined;
        const api = treeApiRef.current;
        if (api) {
          api.collapseAll(options);
          return;
        }
        // 与主路径同 scope，禁止无参整树 collapse
        collapseAllFolders(options);
      },
      expandAll: (rootPath) => {
        const options = reviewExpandOptions(rootPath);
        const api = treeApiRef.current;
        if (api) {
          api.expandAll(options);
          return;
        }
        // 与主路径同 options，禁止无参整树 / 默认 3 层
        expandAllFolders(options);
      },
    });
  }, [
    collapseAllFolders,
    expandAllFolders,
    hasTree,
    sidebarCollapsed,
    treeApiRef,
    treeLoading,
  ]);
  useLayoutEffect(() => {
    if (
      treeFocus == null ||
      lastRevealedNonceRef.current === treeFocus.nonce ||
      sidebarCollapsed ||
      treeLoading === true ||
      !hasTree
    ) {
      return;
    }
    const api = treeApiRef.current;
    if (!api) {
      return;
    }
    lastRevealedNonceRef.current = treeFocus.nonce;
    revealGitReviewTreeSelection(api, treeFocus.path, {
      expandTarget: true,
      preserveFocus: true,
    });
  }, [hasTree, sidebarCollapsed, treeApiRef, treeFocus, treeLoading]);

  const toggleSearch = () => {
    if (!hasTree || treeLoading) {
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
    onOpenPath &&
    gitRootPath &&
    contextId &&
    (treeModel || treeLoading) ? (
      <GitReviewTreeSidebar
        context={context}
        contextId={contextId}
        gitRootPath={gitRootPath}
        mutationAuthorityBlocked={mutationAuthorityBlocked}
        onOpenPath={onOpenPath}
        {...(isActiveOpenPath ? { isActiveOpenPath } : {})}
        {...(onContextMenuSession ? { onContextMenuSession } : {})}
        {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
        {...(sidebarHeader === undefined ? {} : { sidebarHeader })}
        {...(sourcePanelId ? { sourcePanelId } : {})}
        treeLoading={treeLoading}
        treeModel={
          treeModel ??
          ({
            items: [],
            visibleGroups: [],
            groupCounts: { conflict: 0, staged: 0, unstaged: 0 },
            groupLabels: {
              committed: "",
              conflict: "",
              staged: "",
              unstaged: "",
            },
            entryByKey: new Map(),
            fileRefByNodeId: new Map(),
            getFileRefForTreePath: () => undefined,
            getFileRefsUnderTreePath: () => [],
            getGroupForTreePath: () => undefined,
            getGroupRootPath: () => undefined,
            getRepoRelativePath: () => null,
            orderedFileRefs: [],
            mutation: { expectedIndexRevision: null, uncommitted: true },
          } satisfies ReturnType<typeof gitReviewTreeModel>)
        }
        treeSearch={treeSearch}
      />
    ) : null;

  return (
    <FilePanelLayout
      contentPanelId="git-review-diff"
      header={
        <FilePanelHeader
          center={headerCenter ?? null}
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
                  "Hide changed files"
                )}
                expandLabel={pluginText(
                  context,
                  "reviewTreeExpand",
                  "Show changed files"
                )}
                hidden={!hasTree}
                onToggle={() => {
                  if (sidebarCollapsed) {
                    setSidebarCollapsed(false);
                  } else {
                    collapseSidebar();
                  }
                }}
                shortcut={filePanelTreeToggleShortcutLabel()}
              />
              {hasTree ? (
                <FilePanelSearchButton
                  disabled={treeLoading === true}
                  label={pluginText(
                    context,
                    "reviewTreeSearch",
                    "Find in changed files"
                  )}
                  onOpenSearch={toggleSearch}
                />
              ) : null}
              {headerLeading}
            </>
          }
        />
      }
      {...(onContentResize === undefined ? {} : { onContentResize })}
      onSidebarAutoCollapse={collapseSidebar}
      sidebar={sidebar}
      sidebarPanelId="git-review-tree"
      sidebarWidthStorageKey={REVIEW_TREE_WIDTH_STORAGE_KEY}
    >
      {children}
    </FilePanelLayout>
  );
}
