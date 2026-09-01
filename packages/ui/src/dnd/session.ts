/**
 * Module-level drag session shared by Sortable / Droppable instances.
 * One drag at a time; foreign lists subscribe to paint a live insertion gap.
 */

export const DRAG_SLOP_PX = 4;
export const AUTO_SCROLL_EDGE_PX = 28;
export const AUTO_SCROLL_STEP_PX = 12;

export interface SortableDragSession {
  /** Visual size of the dragged item (foreign gap sizing). */
  height: number;
  itemId: string;
  /** Droppable currently under the pointer. */
  overId: string | null;
  /** Droppable hosting the source Sortable (null when unwrapped). */
  sourceId: string | null;
  width: number;
  /** Last pointer position, viewport px. */
  x: number;
  y: number;
}

const dropHandlers = new Map<string, (itemId: string) => void>();
const insertHandlers = new Map<
  string,
  (itemId: string, x: number, y: number) => void
>();
const sessionListeners = new Set<
  (session: SortableDragSession | null) => void
>();
let activeSession: SortableDragSession | null = null;

export function registerDroppable(
  id: string,
  onDrop: (itemId: string) => void
): () => void {
  dropHandlers.set(id, onDrop);
  return () => {
    if (dropHandlers.get(id) === onDrop) {
      dropHandlers.delete(id);
    }
  };
}

export function droppableHandler(
  id: string
): ((itemId: string) => void) | undefined {
  return dropHandlers.get(id);
}

/**
 * A Sortable inside a Droppable registers here to accept foreign items with
 * a live insertion index. Wins over the plain `Droppable.onDrop`.
 */
export function registerSortableInsert(
  id: string,
  handler: (itemId: string, x: number, y: number) => void
): () => void {
  insertHandlers.set(id, handler);
  return () => {
    if (insertHandlers.get(id) === handler) {
      insertHandlers.delete(id);
    }
  };
}

export function sortableInsertHandler(
  id: string
): ((itemId: string, x: number, y: number) => void) | undefined {
  return insertHandlers.get(id);
}

export function publishSortableDrag(session: SortableDragSession | null): void {
  activeSession = session;
  for (const listener of sessionListeners) {
    listener(session);
  }
}

export function subscribeSortableDrag(
  listener: (session: SortableDragSession | null) => void
): () => void {
  sessionListeners.add(listener);
  listener(activeSession);
  return () => {
    sessionListeners.delete(listener);
  };
}

function elementsUnderPoint(clientX: number, clientY: number): Element[] {
  if (typeof document.elementsFromPoint === "function") {
    const stack = document.elementsFromPoint(clientX, clientY);
    if (stack.length > 0) {
      return stack;
    }
  }
  const top = document.elementFromPoint?.(clientX, clientY);
  return top instanceof Element ? [top] : [];
}

export function droppableIdFromPoint(
  clientX: number,
  clientY: number
): string | null {
  for (const node of elementsUnderPoint(clientX, clientY)) {
    if (node.closest("[data-slot=dnd-ghost]")) {
      continue;
    }
    const hit = node.closest("[data-slot=canvas-droppable]");
    if (hit instanceof HTMLElement) {
      return hit.dataset.droppableId ?? null;
    }
  }
  return null;
}

export function setDropOver(id: string | null): void {
  for (const node of document.querySelectorAll(
    "[data-slot=canvas-droppable]"
  )) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (id && node.dataset.droppableId === id) {
      node.setAttribute("data-drop-over", "");
    } else {
      node.removeAttribute("data-drop-over");
    }
  }
}

/**
 * One auto-scroll tick: nudge the nearest scrollable container under the
 * pointer when the pointer sits within the edge band. Called per animation
 * frame while a drag is active.
 */
export function autoScrollStep(x: number, y: number): void {
  let node: HTMLElement | null = null;
  for (const hit of elementsUnderPoint(x, y)) {
    if (hit.closest("[data-slot=dnd-ghost]")) {
      continue;
    }
    if (hit instanceof HTMLElement) {
      node = hit;
      break;
    }
  }
  while (node && node !== document.body) {
    const canY = node.scrollHeight > node.clientHeight + 1;
    const canX = node.scrollWidth > node.clientWidth + 1;
    if (canY || canX) {
      const style = window.getComputedStyle(node);
      const scrollY = canY && /(auto|scroll)/.test(style.overflowY);
      const scrollX = canX && /(auto|scroll)/.test(style.overflowX);
      if (scrollY || scrollX) {
        const rect = node.getBoundingClientRect();
        if (scrollY) {
          if (y < rect.top + AUTO_SCROLL_EDGE_PX) {
            node.scrollTop -= AUTO_SCROLL_STEP_PX;
          } else if (y > rect.bottom - AUTO_SCROLL_EDGE_PX) {
            node.scrollTop += AUTO_SCROLL_STEP_PX;
          }
        }
        if (scrollX) {
          if (x < rect.left + AUTO_SCROLL_EDGE_PX) {
            node.scrollLeft -= AUTO_SCROLL_STEP_PX;
          } else if (x > rect.right - AUTO_SCROLL_EDGE_PX) {
            node.scrollLeft += AUTO_SCROLL_STEP_PX;
          }
        }
        return;
      }
    }
    node = node.parentElement;
  }
}
