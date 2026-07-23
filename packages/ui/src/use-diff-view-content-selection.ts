import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { type RefObject, useCallback } from "react";
import type { ParsedItemCacheEntry } from "./diff-view-items.ts";
import {
  clearBrowserTextSelection,
  type DiffPointerLineHit,
  resolveDiffPointerLineHit,
  selectionFromPointerDrag,
} from "./diff-view-pointer-selection.ts";
import { selectedLinesTextFromCodeViewItem } from "./diff-view-selection-text.ts";

export function useDiffViewContentSelection(input: {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, CodeViewItem>;
  } | null>;
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly contentDragAnchorRef: RefObject<DiffPointerLineHit | null>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly selectedTextRef: RefObject<string>;
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
    [codeViewRef, contentDragAnchorRef, snapshotSelectedText]
  );

  return { handlePointerDownCapture, snapshotSelectedText };
}
