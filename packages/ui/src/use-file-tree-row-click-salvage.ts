import type { useFileTree } from "@pierre/trees/react";
import * as React from "react";
import type { FileTreeRefs } from "./file-tree-internal.ts";
import { isDirectoryHandle } from "./file-tree-model.ts";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

/**
 * 行点击丢失兜底。
 *
 * 库的行激活绑定在 React onClick 上。树滚动定位后立即点击时,
 * pointerdown 与 pointerup 之间虚拟化行池会重排(行 DOM detach/reattach)
 * 或滚动抑制层([data-is-scrolling] pointer-events:none)改变命中目标,
 * 浏览器因目标链断裂不再合成 click —— 库完全收不到这次点击,
 * 表现为「滚动后第一次点击目录树无反应」。
 * 这里在捕获阶段配对 pointerdown/pointerup:两者命中同一行且随后
 * 没有等价的 click 到达时,按官方语义补齐这次行激活。
 */
export function useFileTreeRowClickSalvage({
  containerRef,
  lastOpenedPathRef,
  model,
  readRefs,
}: {
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly lastOpenedPathRef: React.MutableRefObject<string | null>;
  readonly model: FileTreeModel;
  readonly readRefs: () => FileTreeRefs;
}): {
  onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUpCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const rowClickAtPoint = React.useCallback(
    (event: { clientX: number; clientY: number }): HTMLElement | null => {
      const shadowRoot = containerRef.current?.querySelector(
        "file-tree-container"
      )?.shadowRoot;
      if (!shadowRoot) {
        return null;
      }
      let hit: HTMLElement | null = null;
      for (const row of shadowRoot.querySelectorAll<HTMLElement>(
        "[data-item-path]"
      )) {
        const rect = row.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX >= rect.right ||
          event.clientY < rect.top ||
          event.clientY >= rect.bottom
        ) {
          continue;
        }
        // sticky 目录头视觉在普通行之上,同点命中时优先。
        if (row.dataset.fileTreeStickyRow === "true") {
          return row;
        }
        hit = row;
      }
      return hit;
    },
    [containerRef]
  );
  const pendingRowPointerRef = React.useRef<{
    path: string;
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const pendingRowOpenTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const clearPendingRowOpen = React.useCallback(() => {
    if (pendingRowOpenTimerRef.current !== null) {
      clearTimeout(pendingRowOpenTimerRef.current);
      pendingRowOpenTimerRef.current = null;
    }
  }, []);
  React.useEffect(() => clearPendingRowOpen, [clearPendingRowOpen]);
  const rowPathFromEvent = React.useCallback(
    (
      event: { nativeEvent: Event },
      point: { clientX: number; clientY: number }
    ) => {
      const composed = event.nativeEvent.composedPath()[0];
      const target = composed instanceof Element ? composed : null;
      const row =
        target?.closest<HTMLElement>("[data-item-path]") ??
        // 滚动抑制层 pointer-events:none 时事件穿透,composedPath 里没有行;
        // 坐标几何回退保证仍能识别落点行。
        rowClickAtPoint(point);
      return row?.dataset.itemPath ?? null;
    },
    [rowClickAtPoint]
  );
  const onPointerDownCapture = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pendingRowPointerRef.current = null;
      clearPendingRowOpen();
      if (event.button !== 0) {
        return;
      }
      const path = rowPathFromEvent(event, event);
      if (path && readRefs().itemsByPath.get(path)) {
        pendingRowPointerRef.current = {
          path,
          time: event.timeStamp,
          x: event.clientX,
          y: event.clientY,
        };
      }
    },
    [clearPendingRowOpen, readRefs, rowPathFromEvent]
  );
  const onPointerUpCapture = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pending = pendingRowPointerRef.current;
      pendingRowPointerRef.current = null;
      if (
        !pending ||
        event.button !== 0 ||
        event.timeStamp - pending.time > 750 ||
        Math.abs(event.clientX - pending.x) > 6 ||
        Math.abs(event.clientY - pending.y) > 6 ||
        rowPathFromEvent(event, event) !== pending.path
      ) {
        return;
      }
      // click(若能合成)会在本轮事件循环内紧随 mouseup 派发;
      // 宏任务时仍未被 click 认领才补齐,避免与库的正常路径双触发。
      clearPendingRowOpen();
      pendingRowOpenTimerRef.current = setTimeout(() => {
        pendingRowOpenTimerRef.current = null;
        applyLostRowClick(model, readRefs(), lastOpenedPathRef, pending.path);
      }, 0);
    },
    [clearPendingRowOpen, lastOpenedPathRef, model, readRefs, rowPathFromEvent]
  );
  const onClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const composed = event.nativeEvent.composedPath()[0];
      const target = composed instanceof Element ? composed : null;
      const row = target?.closest<HTMLElement>("[data-item-path]");
      if (row) {
        // click 正常合成:库的 onClick 链路会处理,撤销兜底。
        clearPendingRowOpen();
      }
      // Pierre trees 对已选中行再点不会 bump selectionVersion，
      // selectionChange 不会重跑：这里对已选中文件行补一次 onOpenPath，
      // 覆盖 re-click 重新定位。
      if (!row || row.dataset.itemType === "folder") {
        return;
      }
      const officialPath = row.dataset.itemPath;
      if (!(officialPath && model.getSelectedPaths().includes(officialPath))) {
        return;
      }
      const item = readRefs().itemsByPath.get(officialPath);
      if (item?.kind !== "file") {
        return;
      }
      lastOpenedPathRef.current = item.path;
      readRefs().onOpenPath?.(item.path);
    },
    [clearPendingRowOpen, lastOpenedPathRef, model, readRefs]
  );
  return { onClickCapture, onPointerDownCapture, onPointerUpCapture };
}

/**
 * 浏览器没合成 click 的行点击(down/up 间行池重排/滚动抑制层改变命中链),
 * 按库的行点击语义补齐:目录 toggle,文件选中;已选中文件仍对外 open
 * (对齐 re-click 重新定位)。
 */
function applyLostRowClick(
  model: FileTreeModel,
  refs: {
    readonly itemsByPath: ReadonlyMap<
      string,
      { readonly kind: string; readonly path: string }
    >;
    readonly onOpenPath?: ((path: string) => void) | undefined;
  },
  lastOpenedPathRef: React.MutableRefObject<string | null>,
  officialPath: string
): void {
  const item = refs.itemsByPath.get(officialPath);
  if (!item) {
    return;
  }
  try {
    if (item.kind === "directory") {
      const handle = model.getItem(officialPath);
      if (isDirectoryHandle(handle)) {
        if (handle.isExpanded()) {
          handle.collapse();
        } else {
          handle.expand();
        }
      }
      model.selectOnlyPath(officialPath);
      model.focusPath(officialPath);
      return;
    }
    const alreadySelected = model.getSelectedPaths().includes(officialPath);
    // 未选中:selectOnlyPath 触发 selectionChange,openPath 由既有链路发出。
    model.selectOnlyPath(officialPath);
    model.focusPath(officialPath);
    if (alreadySelected) {
      lastOpenedPathRef.current = item.path;
      refs.onOpenPath?.(item.path);
    }
  } catch {
    // 行已不在可见投影中(虚拟窗口刚重排):放弃补齐。
  }
}
