import { type Ref, useImperativeHandle, useMemo } from "react";
import { scheduleCodeViewLayoutFlush } from "./code-view-runtime.ts";
import { collapseAllTargetIds } from "./collapse-intent.ts";
import { syncRenderedEstimateSkeletons } from "./estimate-skeleton.ts";
import type { DiffViewHandleDeps } from "./handle-deps.ts";
import type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewLineSelection,
} from "./handle-types.ts";
import { createDiffViewUpdateItems } from "./handle-update-items.ts";
import {
  captureDiffViewItemAnchor,
  captureDiffViewTopAnchor,
} from "./item-anchor.ts";
import { reconcileDiffVirtualHeights } from "./layout-apply.ts";
import {
  readBrowserSelectedText,
  resolveDiffPointerLineHit,
} from "./pointer-selection.ts";
import { isRenderedItemVisible } from "./render-watchdog.ts";
import {
  type DiffViewScrollOptions,
  resolveCodeViewScrollElement,
} from "./scroll-behavior.ts";
import {
  getDiffCopyStickyText,
  pinDiffCopyStickyText,
} from "./selection/copy-sticky.ts";
import {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./selection-text.ts";
import { waitForStableViewportLayout } from "./viewport-layout.ts";

const INSTANT_SCROLL_LAYOUT_PASSES = 2;

/**
 * 在 diffs-container host 的 shadow 内选中代码正文（字符级全选视觉）。
 * 仅 adapter 层可读 shadow；失败时调用方仍靠模型文本粘性快照复制。
 */
function selectHostCodeText(host: Element): boolean {
  const root = host.shadowRoot;
  if (!root) {
    return false;
  }
  const target = root.querySelector("[data-code]") ?? root.querySelector("pre");
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return !selection.isCollapsed;
}

export type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewLineSelection,
  PierDiffViewPointerLineHit,
  PierDiffViewUpdateOptions,
} from "./handle-types.ts";
export { acceptDiffViewItem } from "./item-sync.ts";

interface UseDiffViewHandleOptions extends DiffViewHandleDeps {
  readonly ref: Ref<PierDiffViewHandle> | undefined;
}

export function useDiffViewHandle({
  appliedItemsRef,
  auditVisibleItems,
  bumpItemEpoch,
  codeViewRef,
  collapseAllIntentRef,
  collapsedItemsRef,
  expectItemRender,
  firstLayoutItemIdsRef,
  isUserCollapsed,
  itemErrorIdsRef,
  metrics,
  onItemErrorRef,
  parsedItemIndexesRef,
  parsedItemListRef,
  parsedItemsRef,
  ref,
  renderItemIdentitiesRef,
  scheduleRenderWindowReport,
  selectedTextRef,
  setItemCollapsed,
}: UseDiffViewHandleOptions): void {
  const handle = useMemo(
    () =>
      createDiffViewHandle({
        appliedItemsRef,
        auditVisibleItems,
        bumpItemEpoch,
        codeViewRef,
        collapseAllIntentRef,
        collapsedItemsRef,
        expectItemRender,
        firstLayoutItemIdsRef,
        isUserCollapsed,
        itemErrorIdsRef,
        metrics,
        onItemErrorRef,
        parsedItemIndexesRef,
        parsedItemListRef,
        parsedItemsRef,
        renderItemIdentitiesRef,
        scheduleRenderWindowReport,
        selectedTextRef,
        setItemCollapsed,
      }),
    // collapsedItemsRef / isUserCollapsed 经 ref 读最新值；列入 deps 防闭包陈旧
    [
      appliedItemsRef,
      auditVisibleItems,
      bumpItemEpoch,
      codeViewRef,
      collapseAllIntentRef,
      collapsedItemsRef,
      expectItemRender,
      firstLayoutItemIdsRef,
      isUserCollapsed,
      itemErrorIdsRef,
      metrics,
      onItemErrorRef,
      parsedItemIndexesRef,
      parsedItemListRef,
      parsedItemsRef,
      renderItemIdentitiesRef,
      scheduleRenderWindowReport,
      selectedTextRef,
      setItemCollapsed,
    ]
  );
  useImperativeHandle(ref, () => handle, [handle]);
}

function createDiffViewHandle(deps: DiffViewHandleDeps): PierDiffViewHandle {
  const {
    appliedItemsRef,
    auditVisibleItems,
    codeViewRef,
    collapseAllIntentRef,
    firstLayoutItemIdsRef,
    isUserCollapsed,
    metrics,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
    selectedTextRef,
    setItemCollapsed,
  } = deps;
  const resolveScrollContainer = (): HTMLElement | null =>
    resolveCodeViewScrollElement(
      codeViewRef.current?.getInstance()?.getContainerElement()
    );
  const getViewportLayoutKey = (targetItemId?: string): string | null => {
    const viewer = codeViewRef.current?.getInstance();
    const container = resolveScrollContainer();
    if (!(viewer && container)) {
      return null;
    }
    const target =
      targetItemId === undefined
        ? undefined
        : viewer
            .getRenderedItems()
            .find((rendered) => rendered.id === targetItemId);
    let targetTop: number | "none" | "unrendered" = "none";
    if (targetItemId !== undefined) {
      targetTop = target
        ? viewer.getLocalTopForInstance(target.instance)
        : "unrendered";
    }
    return `${container.clientWidth}:${container.clientHeight}:${container.scrollHeight}:${targetTop}`;
  };
  const captureTopAnchor = (): PierDiffViewAnchor | null =>
    captureDiffViewTopAnchor(codeViewRef.current?.getInstance());
  const restoreAnchor = (anchor: PierDiffViewAnchor): boolean => {
    const viewer = codeViewRef.current;
    if (!viewer?.getItem(anchor.id)) {
      return false;
    }
    viewer.scrollTo({
      align: "start",
      behavior: "instant",
      id: anchor.id,
      offset: anchor.offset,
      type: "item",
    });
    return true;
  };
  const updateItems = createDiffViewUpdateItems(deps, {
    capture: captureTopAnchor,
    restore: restoreAnchor,
  });
  return {
    captureItemAnchor: (id) =>
      captureDiffViewItemAnchor(codeViewRef.current?.getInstance(), id),
    captureTopAnchor(): PierDiffViewAnchor | null {
      return captureTopAnchor();
    },
    getRenderedItemHeights(): ReadonlyMap<string, number> {
      const rendered =
        codeViewRef.current?.getInstance()?.getRenderedItems() ?? [];
      return new Map(
        rendered
          .map(
            (item) =>
              [item.id, item.element.getBoundingClientRect().height] as const
          )
          .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      );
    },
    getScrollTop(): number | null {
      const container = resolveScrollContainer();
      return container ? container.scrollTop : null;
    },
    getViewportLayoutKey(targetItemId?: string): string | null {
      return getViewportLayoutKey(targetItemId);
    },
    isViewportReady(): boolean {
      const container = resolveScrollContainer();
      return Boolean(
        container?.isConnected &&
          container.clientWidth > 0 &&
          container.clientHeight > 0 &&
          container.checkVisibility({ visibilityProperty: true })
      );
    },
    requestViewportLayoutSettled(
      targetItemId: string,
      stableFrames: number,
      callback: () => void
    ): () => void {
      return waitForStableViewportLayout(
        () => getViewportLayoutKey(targetItemId),
        stableFrames,
        callback
      );
    },
    getSelectedLines(): PierDiffViewLineSelection | null {
      const selection = codeViewRef.current?.getSelectedLines();
      if (!selection) {
        return null;
      }
      return {
        id: selection.id,
        range: {
          end: selection.range.end,
          ...(selection.range.endSide === undefined
            ? {}
            : { endSide: selection.range.endSide }),
          ...(selection.range.side === undefined
            ? {}
            : { side: selection.range.side }),
          start: selection.range.start,
        },
      };
    },
    resolvePointerLineHit(event) {
      return resolveDiffPointerLineHit(event, codeViewRef.current);
    },
    getSelectedText(): string {
      // Live 优先；粘性仅作菜单快照回退（折叠后短窗内有效，见 copy-sticky 生命周期）。
      const fromBrowser = readBrowserSelectedText();
      if (fromBrowser.length > 0) {
        selectedTextRef.current = fromBrowser;
        pinDiffCopyStickyText(fromBrowser);
        return fromBrowser;
      }
      const viewer = codeViewRef.current;
      const selection = viewer?.getSelectedLines();
      if (selection) {
        const item =
          viewer?.getItem(selection.id) ??
          appliedItemsRef.current?.items.get(selection.id) ??
          parsedItemsRef.current.get(selection.id)?.item;
        const fromModel = selectedLinesTextFromCodeViewItem(
          item,
          selection.range
        );
        if (fromModel.length > 0) {
          selectedTextRef.current = fromModel;
          pinDiffCopyStickyText(fromModel);
          return fromModel;
        }
      }
      // 无 live：回退粘性，并同步 ref ← global（双 store 一致）。
      const sticky = getDiffCopyStickyText() || selectedTextRef.current;
      selectedTextRef.current = sticky;
      return sticky;
    },

    isItemVisible(id: string, cacheKey?: string): boolean {
      const viewer = codeViewRef.current?.getInstance();
      const identity = renderItemIdentitiesRef.current.get(id);
      // cacheKey 仅作可选校验；identity 未建时仍可用 DOM 判可见（首点导航）
      if (identity && cacheKey && identity.cacheKey !== cacheKey) {
        return false;
      }
      const rendered = viewer?.getRenderedItems() ?? [];
      if (rendered.length === 0) {
        return false;
      }
      // 无 identity 时不绑 version，只要 DOM 在视口
      return isRenderedItemVisible(
        viewer?.getContainerElement(),
        rendered,
        id,
        identity?.version
      );
    },
    restoreAnchor(anchor: PierDiffViewAnchor): boolean {
      return restoreAnchor(anchor);
    },
    setScrollTop(scrollTop: number): boolean {
      const container = resolveScrollContainer();
      if (!container) {
        return false;
      }
      container.scrollTop = scrollTop;
      return true;
    },
    scrollToItem(id: string, options?: DiffViewScrollOptions): boolean {
      const viewer = codeViewRef.current;
      const item = viewer?.getItem(id);
      if (!(viewer && item)) {
        return false;
      }
      const wasCollapsed = item.collapsed === true;
      const expandsTarget = wasCollapsed && options?.expandCollapsed !== false;
      // 这次定位会不会改变目标几何：刚展开，或从未渲染过（仍是虚拟估高）。
      // 已在场且不展开的目标无需预测量——多刷一次只是平白扰动布局。
      const firstLayout =
        expandsTarget ||
        firstLayoutItemIdsRef.current.has(id) ||
        renderItemIdentitiesRef.current.has(id) === false;
      if (expandsTarget && !setItemCollapsed(id, false, false)) {
        return false;
      }
      // 显式 behavior 优先（树导航主路径恒传 instant）。
      // 未指定时：新建/刚展开 instant，已在场 smooth（与 DiffsHub 默认一致）。
      const behavior =
        options?.behavior ?? (firstLayout ? "instant" : "smooth");
      viewer.scrollTo({
        align: "start",
        behavior,
        id,
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        type: "item",
      });
      if (behavior === "instant" && firstLayout) {
        // Distant virtual items expand their rendered line window during the
        // first CodeView pass. Flush that same semantic scroll before paint so
        // users never see the estimate-sized target followed by its measured
        // geometry one frame later.
        // 树导航主路径从 useLayoutEffect 进来，同步 render(true) 会在 React 渲染
        // 期触发 Pierre 的 flushSync：只会告警并降级成调度更新，反而拿不到这次
        // 刷新。microtask 仍在 paint 前跑，是唯一能真正兑现该保证的时机。
        scheduleCodeViewLayoutFlush(
          viewer.getInstance(),
          INSTANT_SCROLL_LAYOUT_PASSES
        );
      }
      firstLayoutItemIdsRef.current.delete(id);
      return true;
    },
    scrollToLine(
      id: string,
      lineNumber: number,
      side?: "additions" | "deletions",
      options?: DiffViewScrollOptions
    ): boolean {
      const viewer = codeViewRef.current;
      const item = viewer?.getItem(id);
      if (!(viewer && item)) {
        return false;
      }
      if (
        item.collapsed === true &&
        options?.expandCollapsed !== false &&
        !setItemCollapsed(id, false, false)
      ) {
        return false;
      }
      const behavior = options?.behavior ?? "smooth";
      viewer.scrollTo({
        align: "center",
        behavior,
        id,
        lineNumber,
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        ...(side === undefined ? {} : { side }),
        type: "line",
      });
      if (behavior === "instant") {
        scheduleCodeViewLayoutFlush(
          viewer.getInstance(),
          INSTANT_SCROLL_LAYOUT_PASSES
        );
      }
      return true;
    },
    setAllCollapsed(collapsed: boolean): void {
      // 事务（O(n) 非 O(n²)）：
      // 1) 写视图级意图 2) 批量 updateItem（不逐项 apply）3) 一次 reconcile 钉 H/S
      // 禁止只改可见窗 / 依赖滚动 remeasure 收敛（短拇指根因）。
      collapseAllIntentRef.current = collapsed;
      for (const id of collapseAllTargetIds(
        parsedItemListRef.current,
        collapsed
      )) {
        setItemCollapsed(id, collapsed, false, false);
      }
      const viewer = codeViewRef.current?.getInstance();
      // estimate 默认已是 collapsed，翻转会 early-return，骨架只能在这里补。
      syncRenderedEstimateSkeletons(
        (viewer?.getRenderedItems() ?? []).map((rendered) => rendered.element),
        !collapsed
      );
      // 同同步栈内用 geometry 全表写高并 pin scrollHeight（A1 不变量）。
      reconcileDiffVirtualHeights(viewer, {
        isCollapseAllIntent: () => collapseAllIntentRef.current === true,
        isUserCollapsed,
        metrics,
      });
      auditVisibleItems();
      scheduleRenderWindowReport();
    },
    selectAll(): boolean {
      const viewer = codeViewRef.current;
      if (!viewer) {
        return false;
      }
      // 全选走字符级：模型文本钉粘性快照（复制可靠）+ DOM 选中代码正文（视觉对齐）。
      // 不再 setSelectedLines 整行块选。
      const current = viewer.getSelectedLines();
      const candidateIds: string[] = [];
      if (current?.id) {
        candidateIds.push(current.id);
      }
      const renderedItems = viewer.getInstance()?.getRenderedItems() ?? [];
      for (const rendered of renderedItems) {
        if (!candidateIds.includes(rendered.id)) {
          candidateIds.push(rendered.id);
        }
      }
      for (const item of parsedItemListRef.current) {
        if (!candidateIds.includes(item.id)) {
          candidateIds.push(item.id);
        }
      }
      const renderedById = new Map(
        renderedItems.map(
          (rendered) => [rendered.id, rendered.element] as const
        )
      );
      for (const id of candidateIds) {
        const item =
          viewer.getItem(id) ??
          appliedItemsRef.current?.items.get(id) ??
          parsedItemsRef.current.get(id)?.item;
        const range = fullSelectionRangeForCodeViewItem(item);
        if (!(item && range)) {
          continue;
        }
        const text = selectedLinesTextFromCodeViewItem(item, range);
        if (text.length === 0) {
          continue;
        }
        selectedTextRef.current = text;
        pinDiffCopyStickyText(text);
        viewer.clearSelectedLines();
        const host = renderedById.get(id);
        if (host) {
          selectHostCodeText(host);
        }
        return true;
      }
      return false;
    },
    updateItems,
  };
}
