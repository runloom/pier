import {
  FilePanelHeader,
  FilePanelLayout,
  FilePanelSearchButton,
  FilePanelSidebarToggleButton,
  filePanelTreeToggleShortcutLabel,
} from "@pier/ui/file/panel-layout.tsx";
import type { PierFileTreeExpandAllOptions } from "@pier/ui/file/tree-types.ts";
import { useFileTreeSearch } from "@pier/ui/file/use-tree-search.tsx";
import { type PanelFindAction, usePanelFind } from "@plugins/api/panel-find.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { pluginText } from "../plugin-text.ts";
import type { ReviewTreeFocus } from "./surface-types.ts";
import { GitReviewTreeSidebar } from "./tree/sidebar.tsx";
import type { GitReviewTreeModel } from "./tree.tsx";
import { registerGitReviewTreeFolderHandlers } from "./tree-collapse-registry.ts";
import { revealGitReviewTreeSelection } from "./tree-reveal-selection.ts";

const REVIEW_TREE_WIDTH_STORAGE_KEY = "pier.git.review.treeWidthPx";
const GIT_REVIEW_TREE_EXPAND_ALL_MAX_LEVELS = 64;

const EMPTY_REVIEW_TREE_MODEL = {
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
} satisfies GitReviewTreeModel;

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
  treeLoading?: boolean;
  treeModel?: GitReviewTreeModel | null;
}) {
  const treeSearch = useFileTreeSearch();
  const lastRevealedNonceRef = useRef<number | null>(null);
  const treeHasContent =
    treeLoading === true || (treeModel != null && treeModel.items.length > 0);
  const hasTree = Boolean(treeHasContent && onOpenPath);

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

  const openOrToggleSearch = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      treeSearch.openSearch();
      return;
    }
    treeSearch.toggleSearch();
  }, [setSidebarCollapsed, sidebarCollapsed, treeSearch]);
  const onFind = useCallback(
    (action: PanelFindAction) => {
      if (!hasTree || treeLoading) {
        context.notifications.info(
          pluginText(
            context,
            "reviewSearchUnavailable",
            "Open a git repository first."
          )
        );
        return;
      }
      if ((action === "next" || action === "prev") && treeSearch.open) {
        treeSearch.navigateSearch(action === "next" ? "next" : "previous");
        return;
      }
      openOrToggleSearch();
    },
    [context, hasTree, openOrToggleSearch, treeLoading, treeSearch]
  );
  usePanelFind(sourcePanelId, onFind);
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
        treeModel={treeModel ?? EMPTY_REVIEW_TREE_MODEL}
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
                  onOpenSearch={openOrToggleSearch}
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
