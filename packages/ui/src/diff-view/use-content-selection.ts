import type { CodeViewHandle } from "@pierre/diffs/react";
import { type RefObject, useCallback } from "react";
import {
  composedHtmlPath,
  isInteractiveControlTarget,
} from "./header-events.ts";
import type { PierHunkAnnotationMetadata } from "./hunk-actions.tsx";
import type { ParsedItemCacheEntry, PierDiffCodeViewItem } from "./items.ts";
import {
  clearBrowserTextSelection,
  type DiffPointerLineHit,
  resolveDiffPointerLineHit,
  selectionFromPointerDrag,
} from "./pointer-selection.ts";
import { selectedLinesTextFromCodeViewItem } from "./selection-text.ts";

export function useDiffViewContentSelection(input: {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, PierDiffCodeViewItem>;
  } | null>;
  readonly codeViewRef: RefObject<CodeViewHandle<PierHunkAnnotationMetadata> | null>;
  readonly contentDragAnchorRef: RefObject<DiffPointerLineHit | null>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly selectedTextRef: RefObject<string>;
  readonly onPointerIntent?: () => void;
}): {
  readonly handlePointerDownCapture: (
    event: React.PointerEvent<HTMLDivElement>
  ) => void;
  readonly snapshotSelectedText: () => void;
} {
  const {
    appliedItemsRef,
    codeViewRef,
    contentDragAnchorRef,
    parsedItemsRef,
    selectedTextRef,
    onPointerIntent,
  } = input;

  const snapshotSelectedText = useCallback(() => {
    const selection = codeViewRef.current?.getSelectedLines();
    if (!selection) {
      return;
    }
    const item =
      codeViewRef.current?.getItem(selection.id) ??
      appliedItemsRef.current?.items.get(selection.id) ??
      parsedItemsRef.current.get(selection.id)?.item;
    const text = selectedLinesTextFromCodeViewItem(item, selection.range);
    if (text.length > 0) {
      selectedTextRef.current = text;
    }
  }, [appliedItemsRef, codeViewRef, parsedItemsRef, selectedTextRef]);

  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewer = codeViewRef.current;
      if (!viewer) {
        return;
      }

      // 右键：只快照 live 行选区，绝不触发 onScroll。
      if (event.button === 2) {
        snapshotSelectedText();
        return;
      }
      if (event.button !== 0) {
        return;
      }
      if (isInteractiveControlTarget(composedHtmlPath(event.nativeEvent))) {
        return;
      }

      // 主键按在阅读视口即表示用户接管当前位置。这里必须早于行命中：
      // 原生滚动条 / gutter / diff 空白不会命中 data-line，但拖动它们同样会
      // 取消宿主尚未完成的语义导航。交互控件已在上方过滤，不会误清暂存锚点。
      onPointerIntent?.();

      const hit = resolveDiffPointerLineHit(event.nativeEvent, viewer);
      if (!hit) {
        return;
      }

      // 行号栏交给 Pierre 原生 line selection；正文拖必须映射到同一套行选，
      // 并阻断浏览器蓝选（截图里第 8 行高亮 vs 11-17 蓝选两套并存）。
      clearBrowserTextSelection();
      if (hit.fromNumberColumn) {
        return;
      }

      event.preventDefault();
      contentDragAnchorRef.current = hit;
      viewer.setSelectedLines({
        id: hit.id,
        range: {
          end: hit.lineNumber,
          side: hit.side,
          start: hit.lineNumber,
        },
      });
      snapshotSelectedText();

      const handleMove = (moveEvent: PointerEvent) => {
        const anchor = contentDragAnchorRef.current;
        const currentViewer = codeViewRef.current;
        if (!(anchor && currentViewer)) {
          return;
        }
        moveEvent.preventDefault();
        clearBrowserTextSelection();
        const current = resolveDiffPointerLineHit(moveEvent, currentViewer);
        if (!current) {
          return;
        }
        const next = selectionFromPointerDrag(anchor, current);
        if (!next) {
          return;
        }
        currentViewer.setSelectedLines(next);
      };
      const handleUp = () => {
        contentDragAnchorRef.current = null;
        snapshotSelectedText();
        clearBrowserTextSelection();
        window.removeEventListener("pointermove", handleMove, true);
        window.removeEventListener("pointerup", handleUp, true);
        window.removeEventListener("pointercancel", handleUp, true);
      };
      window.addEventListener("pointermove", handleMove, true);
      window.addEventListener("pointerup", handleUp, true);
      window.addEventListener("pointercancel", handleUp, true);
    },
    [codeViewRef, contentDragAnchorRef, onPointerIntent, snapshotSelectedText]
  );

  return { handlePointerDownCapture, snapshotSelectedText };
}
