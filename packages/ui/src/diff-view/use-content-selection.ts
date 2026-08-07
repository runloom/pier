import type { CodeViewHandle } from "@pierre/diffs/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import type { PierGutterReviewEvent } from "./gutter/gutter-comments.tsx";
import {
  composedHtmlPath,
  isInteractiveControlTarget,
} from "./header-events.ts";
import type { ParsedItemCacheEntry, PierDiffCodeViewItem } from "./items.ts";
import {
  CONTENT_DRAG_THRESHOLD_PX,
  type DiffPointerLineHit,
  isDiffCodeSelection,
  isGutterUtilityPath,
  readBrowserSelectedText,
  readBrowserSelectionLineSpan,
  resolveDiffPointerLineHit,
} from "./pointer-selection.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";
import {
  clearDiffCopyStickyText,
  pinDiffCopyStickyText,
} from "./selection/copy-sticky.ts";
import { selectedLinesTextFromCodeViewItem } from "./selection-text.ts";

/**
 * Diff 指针侧车 + 复制粘性（短生命周期）。
 *
 * 选区：
 * - 正文：浏览器字符选；纯单击不钉复制文本
 * - 拖过阈值后：浏览器选区优先，否则同侧模型行文本作粘性快照
 * - 行号：Pierre 整行选
 * - gutter +：不写行选，清空粘性
 *
 * 粘性：只在有真实选区时 pin；折叠 / 纯单击 / + / unmount 时 clear。
 */
export function useDiffViewContentSelection(input: {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, PierDiffCodeViewItem>;
  } | null>;
  readonly codeViewRef: RefObject<CodeViewHandle<PierDiffAnnotationMetadata> | null>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly selectedTextRef: RefObject<string>;
  readonly onGutterLineActivate?: (event: PierGutterReviewEvent) => void;
  readonly onPointerIntent?: () => void;
}): {
  readonly handleContextMenuCapture: (
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  readonly handlePointerDownCapture: (
    event: React.PointerEvent<HTMLDivElement>
  ) => void;
  readonly snapshotSelectedText: () => void;
} {
  const {
    appliedItemsRef,
    codeViewRef,
    parsedItemsRef,
    selectedTextRef,
    onGutterLineActivate,
    onPointerIntent,
  } = input;

  const bodyDragAnchorRef = useRef<DiffPointerLineHit | null>(null);
  const bodyDragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const clearStickyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const clearCopySnapshot = useCallback(() => {
    selectedTextRef.current = "";
    clearDiffCopyStickyText();
  }, [selectedTextRef]);

  const pinText = useCallback(
    (text: string): void => {
      if (text.length === 0) {
        return;
      }
      if (clearStickyTimerRef.current !== null) {
        clearTimeout(clearStickyTimerRef.current);
        clearStickyTimerRef.current = null;
      }
      selectedTextRef.current = text;
      pinDiffCopyStickyText(text);
    },
    [selectedTextRef]
  );

  const modelTextForLineSpan = useCallback(
    (
      itemId: string,
      start: number,
      end: number,
      side: "additions" | "deletions"
    ): string => {
      const item =
        codeViewRef.current?.getItem(itemId) ??
        appliedItemsRef.current?.items.get(itemId) ??
        parsedItemsRef.current.get(itemId)?.item;
      return selectedLinesTextFromCodeViewItem(item, {
        end: Math.max(start, end),
        side,
        start: Math.min(start, end),
      });
    },
    [appliedItemsRef, codeViewRef, parsedItemsRef]
  );

  const snapshotSelectedText = useCallback(() => {
    const fromBrowser = readBrowserSelectedText();
    if (fromBrowser.length > 0) {
      pinText(fromBrowser);
      return;
    }
    // 浏览器 toString 失败但仍有 data-line 跨度：用模型行文本。
    const span = readBrowserSelectionLineSpan();
    const lineSelection = codeViewRef.current?.getSelectedLines();
    if (span) {
      const itemId =
        lineSelection?.id ??
        codeViewRef.current?.getInstance()?.getRenderedItems()?.[0]?.id;
      if (itemId) {
        const side = lineSelection?.range.side ?? "additions";
        const text = modelTextForLineSpan(itemId, span.start, span.end, side);
        if (text.length > 0) {
          pinText(text);
          return;
        }
      }
    }
    if (lineSelection) {
      const item =
        codeViewRef.current?.getItem(lineSelection.id) ??
        appliedItemsRef.current?.items.get(lineSelection.id) ??
        parsedItemsRef.current.get(lineSelection.id)?.item;
      const text = selectedLinesTextFromCodeViewItem(item, lineSelection.range);
      if (text.length > 0) {
        pinText(text);
      }
    }
  }, [
    appliedItemsRef,
    codeViewRef,
    modelTextForLineSpan,
    parsedItemsRef,
    pinText,
  ]);

  // 仅 diff 正文选区可 pin；折叠后延迟 clear（给右键菜单构建留窗口）。
  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      const text = readBrowserSelectedText();
      if (text.length > 0 && isDiffCodeSelection(selection)) {
        pinText(text);
        return;
      }
      // 无有效 diff 选区：延迟清空，避免 contextmenu 与 collapse 竞态。
      if (clearStickyTimerRef.current !== null) {
        clearTimeout(clearStickyTimerRef.current);
      }
      clearStickyTimerRef.current = setTimeout(() => {
        clearStickyTimerRef.current = null;
        const still = readBrowserSelectedText();
        if (
          still.length === 0 &&
          codeViewRef.current?.getSelectedLines() == null
        ) {
          clearCopySnapshot();
        }
      }, 400);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (clearStickyTimerRef.current !== null) {
        clearTimeout(clearStickyTimerRef.current);
        clearStickyTimerRef.current = null;
      }
      // unmount：清粘性，避免跨面板幽灵复制
      clearCopySnapshot();
    };
  }, [clearCopySnapshot, codeViewRef, pinText]);

  const handleContextMenuCapture = useCallback(
    (_event: React.MouseEvent<HTMLDivElement>) => {
      // 取消待清除，再钉一次（菜单打开前最后机会）。
      if (clearStickyTimerRef.current !== null) {
        clearTimeout(clearStickyTimerRef.current);
        clearStickyTimerRef.current = null;
      }
      snapshotSelectedText();
    },
    [snapshotSelectedText]
  );

  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewer = codeViewRef.current;
      if (!viewer) {
        return;
      }

      const isContextMenuGesture =
        event.button === 2 || (event.button === 0 && event.ctrlKey);
      if (isContextMenuGesture) {
        if (clearStickyTimerRef.current !== null) {
          clearTimeout(clearStickyTimerRef.current);
          clearStickyTimerRef.current = null;
        }
        snapshotSelectedText();
        return;
      }
      if (event.button !== 0) {
        return;
      }

      const path = event.nativeEvent.composedPath();

      if (isGutterUtilityPath(path)) {
        event.preventDefault();
        event.stopPropagation();
        const hit = resolveDiffPointerLineHit(event.nativeEvent, viewer);
        if (hit && onGutterLineActivate) {
          onGutterLineActivate({
            itemId: hit.id,
            lineNumber: hit.lineNumber,
            side: hit.side,
          });
        }
        viewer.clearSelectedLines();
        clearCopySnapshot();
        bodyDragAnchorRef.current = null;
        bodyDragOriginRef.current = null;
        return;
      }

      if (isInteractiveControlTarget(composedHtmlPath(event.nativeEvent))) {
        return;
      }

      onPointerIntent?.();

      const hit = resolveDiffPointerLineHit(event.nativeEvent, viewer);
      if (!hit) {
        bodyDragAnchorRef.current = null;
        bodyDragOriginRef.current = null;
        return;
      }

      if (hit.fromNumberColumn) {
        bodyDragAnchorRef.current = null;
        bodyDragOriginRef.current = null;
        return;
      }

      // 正文：记录拖选；纯单击（未过阈值）不钉模型行、并清空旧粘性。
      viewer.clearSelectedLines();
      bodyDragAnchorRef.current = hit;
      bodyDragOriginRef.current = { x: event.clientX, y: event.clientY };

      const handleUp = (upEvent: PointerEvent) => {
        const anchor = bodyDragAnchorRef.current;
        const origin = bodyDragOriginRef.current;
        bodyDragAnchorRef.current = null;
        bodyDragOriginRef.current = null;
        window.removeEventListener("pointerup", handleUp, true);
        window.removeEventListener("pointercancel", handleUp, true);

        if (!(anchor && origin)) {
          return;
        }

        const dx = upEvent.clientX - origin.x;
        const dy = upEvent.clientY - origin.y;
        const moved =
          dx * dx + dy * dy >=
          CONTENT_DRAG_THRESHOLD_PX * CONTENT_DRAG_THRESHOLD_PX;

        // 纯单击：清空粘性，禁止「点一下 = 复制整行」。
        if (!moved) {
          const live = readBrowserSelectedText();
          if (live.length > 0) {
            pinText(live);
          } else {
            clearCopySnapshot();
          }
          return;
        }

        const fromBrowser = readBrowserSelectedText();
        if (fromBrowser.length > 0) {
          pinText(fromBrowser);
          return;
        }

        const current =
          resolveDiffPointerLineHit(upEvent, codeViewRef.current) ?? anchor;
        // 跨文件或跨侧：只钉锚点行，避免错侧整段模型文本。
        if (current.id !== anchor.id || current.side !== anchor.side) {
          const text = modelTextForLineSpan(
            anchor.id,
            anchor.lineNumber,
            anchor.lineNumber,
            anchor.side
          );
          pinText(text);
          return;
        }
        const text = modelTextForLineSpan(
          anchor.id,
          anchor.lineNumber,
          current.lineNumber,
          anchor.side
        );
        pinText(text);
      };

      window.addEventListener("pointerup", handleUp, true);
      window.addEventListener("pointercancel", handleUp, true);
    },
    [
      clearCopySnapshot,
      codeViewRef,
      modelTextForLineSpan,
      onGutterLineActivate,
      onPointerIntent,
      pinText,
      snapshotSelectedText,
    ]
  );

  return {
    handleContextMenuCapture,
    handlePointerDownCapture,
    snapshotSelectedText,
  };
}
