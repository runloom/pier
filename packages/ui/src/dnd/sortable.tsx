"use client";

import { GripVertical } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../utils.ts";
import { useDroppableId } from "./droppable.tsx";
import {
  autoScrollStep,
  DRAG_SLOP_PX,
  droppableHandler,
  droppableIdFromPoint,
  publishSortableDrag,
  registerSortableInsert,
  setDropOver,
  sortableInsertHandler,
  subscribeSortableDrag,
} from "./session.ts";

export interface SortableItemApi {
  handle: ReactNode;
  isDragging: boolean;
}

/** Surfaces whose clicks must never start a whole-item drag. */
const DRAG_IGNORE_SELECTOR =
  "button, a, input, textarea, select, [role='tab'], [contenteditable='true']";

function insertionIndex(
  client: number,
  ids: readonly string[],
  itemEls: Map<string, HTMLElement>,
  orientation: "horizontal" | "vertical"
): number {
  let index = ids.length;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (!id) {
      continue;
    }
    const rect = itemEls.get(id)?.getBoundingClientRect();
    if (!rect) {
      continue;
    }
    const midpoint =
      orientation === "horizontal"
        ? (rect.left + rect.right) / 2
        : (rect.top + rect.bottom) / 2;
    if (client < midpoint) {
      index = i;
      break;
    }
  }
  return index;
}

function SortableHandle({
  isDragging,
  label,
  onPointerDown,
}: {
  isDragging: boolean;
  label: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      data-slot="dnd-handle"
      onPointerDown={onPointerDown}
      type="button"
    >
      <GripVertical data-icon />
    </button>
  );
}

interface GhostRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export function Sortable({
  children,
  className,
  handleLabel = "Drag",
  items,
  onDropItem,
  onReorder,
  orientation = "vertical",
}: {
  children: (itemId: string, item: SortableItemApi) => ReactNode;
  className?: string | undefined;
  handleLabel?: string | undefined;
  items: readonly string[];
  /** Foreign item dropped into this list at index. Enables the live gap. */
  onDropItem?: ((itemId: string, index: number) => void) | undefined;
  /** Same-list reorder commit (called once on drop). */
  onReorder: (items: string[]) => void;
  orientation?: "horizontal" | "vertical" | undefined;
}) {
  const sourceDroppableId = useDroppableId();
  const itemEls = useRef(new Map<string, HTMLElement>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeDragAbortRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      activeDragAbortRef.current?.();
    },
    []
  );

  /** Live same-list order while dragging; committed via onReorder on drop. */
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const previewOrderRef = useRef<string[] | null>(null);
  const [ghostRect, setGhostRect] = useState<GhostRect | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** Gap for a foreign item hovering over this list. */
  const [foreignGap, setForeignGap] = useState<{
    height: number;
    index: number;
  } | null>(null);

  const applyPreview = (next: string[] | null): void => {
    previewOrderRef.current = next;
    setPreviewOrder((current) =>
      current && next && current.join("\0") === next.join("\0") ? current : next
    );
  };

  // Accept foreign items with a live insertion index (wins over plain onDrop).
  useEffect(() => {
    if (!(sourceDroppableId && onDropItem)) {
      return;
    }
    return registerSortableInsert(sourceDroppableId, (itemId, x, y) => {
      const client = orientation === "horizontal" ? x : y;
      const index = insertionIndex(
        client,
        itemsRef.current,
        itemEls.current,
        orientation
      );
      onDropItem(itemId, index);
    });
  }, [onDropItem, orientation, sourceDroppableId]);

  // Paint the gap while a foreign drag hovers this list.
  useEffect(() => {
    if (!(sourceDroppableId && onDropItem)) {
      return;
    }
    return subscribeSortableDrag((session) => {
      if (
        !session ||
        session.sourceId === sourceDroppableId ||
        session.overId !== sourceDroppableId
      ) {
        setForeignGap(null);
        return;
      }
      const client = orientation === "horizontal" ? session.x : session.y;
      const index = insertionIndex(
        client,
        itemsRef.current,
        itemEls.current,
        orientation
      );
      setForeignGap((current) =>
        current && current.index === index && current.height === session.height
          ? current
          : { height: session.height, index }
      );
    });
  }, [onDropItem, orientation, sourceDroppableId]);

  const startDrag = (
    itemId: string,
    event: ReactPointerEvent<HTMLElement>
  ): void => {
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const sourceEl = itemEls.current.get(itemId);
    const sourceRect = sourceEl?.getBoundingClientRect();
    const grabX = sourceRect ? startX - sourceRect.left : 0;
    const grabY = sourceRect ? startY - sourceRect.top : 0;
    const height = sourceRect?.height ?? 0;
    const width = sourceRect?.width ?? 0;
    let active = false;
    let lastX = startX;
    let lastY = startY;
    let rafId = 0;
    const axis = orientation === "horizontal" ? "clientX" : "clientY";

    const scrollLoop = () => {
      autoScrollStep(lastX, lastY);
      rafId = requestAnimationFrame(scrollLoop);
    };

    const positionGhost = (x: number, y: number) => {
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.transform = `translate(${x - grabX}px, ${y - grabY}px) rotate(1.5deg) scale(1.02)`;
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!active) {
        if (
          Math.abs(lastX - startX) < DRAG_SLOP_PX &&
          Math.abs(lastY - startY) < DRAG_SLOP_PX
        ) {
          return;
        }
        active = true;
        setDraggingId(itemId);
        setGhostRect({
          height,
          width,
          x: sourceRect?.left ?? lastX,
          y: sourceRect?.top ?? lastY,
        });
        document.body.style.userSelect = "none";
        rafId = requestAnimationFrame(scrollLoop);
      }
      moveEvent.preventDefault();
      positionGhost(lastX, lastY);
      const overId = droppableIdFromPoint(lastX, lastY);
      setDropOver(overId);
      publishSortableDrag({
        height,
        itemId,
        overId,
        sourceId: sourceDroppableId,
        width,
        x: lastX,
        y: lastY,
      });
      if (overId !== null && overId !== sourceDroppableId) {
        // Item visually leaves the source list; the ghost carries it.
        applyPreview(itemsRef.current.filter((id) => id !== itemId));
        return;
      }
      const visual = (previewOrderRef.current ?? [...itemsRef.current]).filter(
        (id) => id !== itemId
      );
      const insertAt = insertionIndex(
        moveEvent[axis],
        visual,
        itemEls.current,
        orientation
      );
      applyPreview([
        ...visual.slice(0, insertAt),
        itemId,
        ...visual.slice(insertAt),
      ]);
    };

    const finish = (upEvent: PointerEvent, commit: boolean) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      activeDragAbortRef.current = null;
      if (!active) {
        return;
      }
      cancelAnimationFrame(rafId);
      document.body.style.userSelect = "";
      const finalOrder = previewOrderRef.current;
      setDraggingId(null);
      setGhostRect(null);
      applyPreview(null);
      setDropOver(null);
      publishSortableDrag(null);
      if (!commit) {
        return;
      }
      const overId = droppableIdFromPoint(upEvent.clientX, upEvent.clientY);
      if (overId && overId !== sourceDroppableId) {
        const insert = sortableInsertHandler(overId);
        if (insert) {
          insert(itemId, upEvent.clientX, upEvent.clientY);
          return;
        }
        droppableHandler(overId)?.(itemId);
        return;
      }
      onReorder(finalOrder ?? [...itemsRef.current]);
    };
    const onUp = (upEvent: PointerEvent) => finish(upEvent, true);
    const onCancel = (upEvent: PointerEvent) => finish(upEvent, false);

    activeDragAbortRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (active) {
        cancelAnimationFrame(rafId);
        document.body.style.userSelect = "";
        setDraggingId(null);
        setGhostRect(null);
        applyPreview(null);
        setDropOver(null);
        publishSortableDrag(null);
      }
      activeDragAbortRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const onItemPointerDown = (
    itemId: string,
    event: ReactPointerEvent<HTMLElement>
  ): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(DRAG_IGNORE_SELECTOR)) {
      return;
    }
    startDrag(itemId, event);
  };

  const onHandlePointerDown = (
    itemId: string,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    startDrag(itemId, event);
  };

  const renderIds = previewOrder ?? [...items];
  const rows: ReactNode[] = [];
  const gapRow = foreignGap ? (
    <li
      aria-hidden
      className="shrink-0 rounded-lg border-2 border-primary/40 border-dashed bg-primary/5"
      data-slot="dnd-gap"
      key="dnd-gap"
      style={{ height: foreignGap.height }}
    />
  ) : null;
  renderIds.forEach((itemId, index) => {
    if (gapRow && foreignGap && index === foreignGap.index) {
      rows.push(gapRow);
    }
    rows.push(
      <li
        className={cn("select-none", draggingId === itemId && "opacity-30")}
        data-no-drag=""
        data-sortable-id={itemId}
        key={itemId}
        onPointerDown={(event) => onItemPointerDown(itemId, event)}
        ref={(node) => {
          if (node) {
            itemEls.current.set(itemId, node);
          } else {
            itemEls.current.delete(itemId);
          }
        }}
      >
        {children(itemId, {
          handle: (
            <SortableHandle
              isDragging={draggingId === itemId}
              label={handleLabel}
              onPointerDown={(event) => onHandlePointerDown(itemId, event)}
            />
          ),
          isDragging: draggingId === itemId,
        })}
      </li>
    );
  });
  if (gapRow && foreignGap && foreignGap.index >= renderIds.length) {
    rows.push(gapRow);
  }

  return (
    <>
      <ul
        className={cn(
          "m-0 flex list-none p-0",
          orientation === "horizontal" ? "flex-row gap-2" : "flex-col gap-2",
          className
        )}
        data-slot="canvas-sortable"
      >
        {rows}
      </ul>
      {draggingId && ghostRect
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed top-0 left-0 z-50 rounded-lg opacity-95 shadow-2xl ring-2 ring-ring/20"
              data-slot="dnd-ghost"
              ref={(node) => {
                ghostRef.current = node;
                if (node) {
                  node.style.transform = `translate(${ghostRect.x}px, ${ghostRect.y}px) rotate(1.5deg) scale(1.02)`;
                }
              }}
              style={{
                height: ghostRect.height || undefined,
                width: ghostRect.width || undefined,
              }}
            >
              {children(draggingId, {
                handle: <SortableHandle isDragging label={handleLabel} />,
                isDragging: true,
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
