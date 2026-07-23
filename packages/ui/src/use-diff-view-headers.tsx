import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { type RefObject, useCallback, useEffect, useMemo } from "react";
import {
  CollapseDiffButton,
  type PierDiffViewLabels,
} from "./diff-view-collapse.tsx";
import {
  fileDiffLineStats,
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
} from "./diff-view-items.ts";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
} from "./diff-view-presentation.ts";
import { DiffHeaderActions } from "./diff-view-stage-button.tsx";
import type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
} from "./use-diff-view-handle.ts";

const USER_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

function isHtmlElement(
  value: EventTarget | null | undefined
): value is HTMLElement {
  return value instanceof HTMLElement;
}

function composedHtmlPath(event: Event): HTMLElement[] {
  return event.composedPath().filter(isHtmlElement);
}

function findHeaderFromPath(path: readonly HTMLElement[]): HTMLElement | null {
  return path.find((node) => node.hasAttribute("data-diffs-header")) ?? null;
}

function findTitleFromPath(path: readonly HTMLElement[]): HTMLElement | null {
  return path.find((node) => node.hasAttribute("data-title")) ?? null;
}

/** Clicks on real controls must not also toggle collapse / open file. */
function isHeaderControlTarget(path: readonly HTMLElement[]): boolean {
  for (const node of path) {
    if (node.hasAttribute("data-diffs-header")) {
      break;
    }
    if (
      node.hasAttribute("data-slot") &&
      node.getAttribute("data-slot") === "pier-diff-header-actions"
    ) {
      return true;
    }
    const tag = node.tagName;
    if (
      tag === "BUTTON" ||
      tag === "A" ||
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      tag === "LABEL"
    ) {
      return true;
    }
    if (node.getAttribute("role") === "button") {
      return true;
    }
  }
  return false;
}

function findRenderedItemIdFromPath(
  path: readonly EventTarget[],
  rendered: readonly { readonly element: Element; readonly id: string }[]
): string | null {
  // composedPath already crosses open shadow trees and includes the host
  // element — match hosts without reading shadow tree (governance).
  const hostIds = new Map(
    rendered.map((item) => [item.element, item.id] as const)
  );
  for (const node of path) {
    if (node instanceof Element) {
      const id = hostIds.get(node);
      if (id !== undefined) {
        return id;
      }
    }
  }
  return null;
}

export function useDiffViewHeaders(options: {
  readonly appliedItemsRef: RefObject<{
    readonly items: Map<string, CodeViewItem>;
    readonly key: string;
  } | null>;
  readonly auditVisibleItems: () => void;
  readonly codeViewItems: CodeViewItem[];
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly collapsedItemsRef: RefObject<
    Map<string, DiffViewCollapsedItemState>
  >;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly inputs: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  readonly onDiscardFile?: ((itemId: string) => void) | undefined;
  readonly onOpenFile?: ((itemId: string) => void) | undefined;
  readonly onToggleStage?: ((itemId: string) => void) | undefined;
  readonly onScroll?: (() => void) | undefined;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<CodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
}): {
  readonly handleCodeViewScroll: () => void;
  readonly handleHeaderClickCapture: (
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  readonly handleUserScrollKey: (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => void;
  readonly renderHeaderMetadata: (item: CodeViewItem) => React.ReactNode;
  readonly renderHeaderPrefix: (item: CodeViewItem) => React.ReactNode;
  readonly setItemCollapsed: (
    id: string,
    nextCollapsed?: boolean,
    preserveTopAnchor?: boolean
  ) => boolean;
} {
  const {
    appliedItemsRef,
    auditVisibleItems,
    codeViewItems,
    codeViewRef,
    collapsedItemsRef,
    expectItemRender,
    inputs,
    labels,
    onDiscardFile,
    onOpenFile,
    onToggleStage,
    onScroll,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  } = options;

  const setItemCollapsed = useCallback(
    (id: string, nextCollapsed?: boolean, preserveTopAnchor = true) => {
      const handle = codeViewRef.current;
      const viewer = handle?.getInstance();
      const item = handle?.getItem(id);
      const itemIndex = parsedItemIndexesRef.current.get(id);
      const parsedItem = parsedItemsRef.current.get(id);
      if (
        !(handle && viewer && item && itemIndex !== undefined && parsedItem)
      ) {
        return false;
      }
      const collapsed = nextCollapsed ?? item.collapsed !== true;
      if (item.collapsed === collapsed) {
        return true;
      }
      const itemTop = viewer.getTopForItem(id);
      const shouldAnchor =
        preserveTopAnchor &&
        itemTop !== undefined &&
        itemTop !== null &&
        itemTop < viewer.getScrollTop();
      const nextRevision =
        (collapsedItemsRef.current.get(id)?.revision ?? 0) + 1;
      // 克隆而非就地改写:CodeView 里可能持有 parsed cache 的原始 item 引用,
      // 就地 +1 会把缓存条目的内容版本一并顶高,与「内容版本 + 折叠修订」的
      // 统一公式撞号 —— 折叠中的占位符会与稍后到达的真实正文同号,
      // CodeView 按 version 去重时把正文当作无变化丢弃(表现为导航后空正文)。
      const nextItem = {
        ...parsedItem.item,
        collapsed,
        version: parsedItem.version + nextRevision,
      };
      if (!handle.updateItem(nextItem)) {
        return false;
      }
      collapsedItemsRef.current.set(id, {
        collapsed,
        revision: nextRevision,
      });
      parsedItemListRef.current[itemIndex] = nextItem;
      renderItemIdentitiesRef.current.set(id, {
        cacheKey: parsedItem.cacheKey,
        version: nextItem.version,
      });
      appliedItemsRef.current?.items.set(id, nextItem);
      expectItemRender(id, nextItem.version);
      if (shouldAnchor) {
        handle.scrollTo({
          align: "start",
          id,
          type: "item",
        });
      }
      auditVisibleItems();
      scheduleRenderWindowReport();
      return true;
    },
    [
      appliedItemsRef,
      auditVisibleItems,
      codeViewRef,
      collapsedItemsRef,
      expectItemRender,
      parsedItemIndexesRef,
      parsedItemListRef,
      parsedItemsRef,
      renderItemIdentitiesRef,
      scheduleRenderWindowReport,
    ]
  );
  const handleToggleItemCollapsed = useCallback(
    (item: CodeViewItem) => {
      setItemCollapsed(item.id);
    },
    [setItemCollapsed]
  );
  const handleCodeViewScroll = useCallback(() => {
    auditVisibleItems();
    scheduleRenderWindowReport();
  }, [auditVisibleItems, scheduleRenderWindowReport]);
  const handleUserScrollKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (USER_SCROLL_KEYS.has(event.key)) {
        onScroll?.();
      }
    },
    [onScroll]
  );
  useEffect(() => {
    if (codeViewItems.length === 0) {
      return;
    }
    auditVisibleItems();
    scheduleRenderWindowReport();
  }, [auditVisibleItems, codeViewItems, scheduleRenderWindowReport]);
  const inputById = useMemo(() => {
    const map = new Map<string, PierDiffViewItem>();
    for (const input of inputs) {
      map.set(input.id, input);
    }
    return map;
  }, [inputs]);
  const handleHeaderClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const path = composedHtmlPath(event.nativeEvent);
      const header = findHeaderFromPath(path);
      if (!header) {
        return;
      }
      if (isHeaderControlTarget(path)) {
        return;
      }
      const viewer = codeViewRef.current?.getInstance();
      if (!viewer) {
        return;
      }
      const itemId = findRenderedItemIdFromPath(
        event.nativeEvent.composedPath(),
        viewer.getRenderedItems()
      );
      if (!itemId) {
        return;
      }
      const title = findTitleFromPath(path);
      if (title && onOpenFile) {
        event.preventDefault();
        event.stopPropagation();
        onOpenFile(itemId);
        return;
      }
      // Title without open handler still collapses like blank chrome.
      const input = inputById.get(itemId);
      if (
        input !== undefined &&
        pierDiffItemPresentation(input) === "loading"
      ) {
        return;
      }
      const item = codeViewRef.current?.getItem(itemId);
      if (item?.type !== "diff") {
        return;
      }
      if (
        item.fileDiff.splitLineCount === 0 &&
        item.fileDiff.unifiedLineCount === 0 &&
        item.collapsed !== true
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleToggleItemCollapsed(item);
    },
    [codeViewRef, handleToggleItemCollapsed, inputById, onOpenFile]
  );
  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem) => {
      if (item.type !== "diff") {
        return null;
      }
      const input = inputById.get(item.id);
      const loading =
        input !== undefined && pierDiffItemPresentation(input) === "loading";
      const emptyReady =
        !loading &&
        item.fileDiff.splitLineCount === 0 &&
        item.fileDiff.unifiedLineCount === 0;
      return (
        <CollapseDiffButton
          collapsed={item.collapsed === true}
          disabled={emptyReady}
          labels={labels}
          loading={loading}
          onToggle={() => handleToggleItemCollapsed(item)}
        />
      );
    },
    [handleToggleItemCollapsed, inputById, labels]
  );
  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem) => {
      if (item.type !== "diff") {
        return null;
      }
      const input = inputById.get(item.id);
      const loading =
        input !== undefined && pierDiffItemPresentation(input) === "loading";
      const { additions, deletions } = fileDiffLineStats(item.fileDiff);
      // Stats/notices only after ready; stage cluster still shows on placeholders.
      const showStats =
        !loading && shouldRenderDiffLineStats({ additions, deletions });
      const stageControl = input?.stageControl;
      const showStage = stageControl != null && onToggleStage != null;
      const stateNotice = loading ? "" : (input?.stateNotice?.trim() ?? "");
      const showNotice = stateNotice.length > 0;
      if (!(showStats || showStage || showNotice)) {
        return null;
      }
      // One light-DOM root so the header-metadata slot can be width:100%.
      // Fragment would assign multiple nodes and break far-right actions.
      return (
        <span
          className="flex w-full min-w-0 items-center gap-2"
          data-slot="pier-diff-header-metadata"
        >
          {showNotice ? (
            <span
              className="min-w-0 truncate text-muted-foreground text-xs"
              data-slot="pier-diff-header-state-notice"
              title={stateNotice}
            >
              {stateNotice}
            </span>
          ) : null}
          {showStats ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums"
              data-slot="pier-diff-header-stats"
            >
              {deletions > 0 ? (
                <span
                  data-pier-diff-stat="deletions"
                  style={{
                    color: "var(--diffs-deletion-base)",
                    fontFamily:
                      "var(--diffs-font-family, var(--diffs-font-fallback))",
                  }}
                >
                  {`-${deletions}`}
                </span>
              ) : null}
              {additions > 0 ? (
                <span
                  data-pier-diff-stat="additions"
                  style={{
                    color: "var(--diffs-addition-base)",
                    fontFamily:
                      "var(--diffs-font-family, var(--diffs-font-fallback))",
                  }}
                >
                  {`+${additions}`}
                </span>
              ) : null}
            </span>
          ) : null}
          {showStage && stageControl ? (
            <span
              className="ml-auto inline-flex shrink-0 items-center"
              data-slot="pier-diff-header-actions"
            >
              <DiffHeaderActions
                canDiscard={stageControl.canDiscard === true}
                labels={labels}
                {...(onDiscardFile
                  ? { onDiscard: () => onDiscardFile(item.id) }
                  : {})}
                onToggleStage={() => onToggleStage(item.id)}
                stageControl={stageControl}
              />
            </span>
          ) : null}
        </span>
      );
    },
    [inputById, labels, onDiscardFile, onToggleStage]
  );
  return {
    handleCodeViewScroll,
    handleHeaderClickCapture,
    handleUserScrollKey,
    renderHeaderMetadata,
    renderHeaderPrefix,
    setItemCollapsed,
  };
}
