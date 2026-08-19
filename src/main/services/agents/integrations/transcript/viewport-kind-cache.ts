import {
  type CursorInteractionKind,
  cursorViewportInteractionKind,
} from "./cursor-question.ts";

export interface ViewportKindCache {
  clear(key: string): void;
  clearAll(): void;
  kindFor(key: string, text: string): CursorInteractionKind | null;
  rekey(from: string, to: string): void;
}

/**
 * Skip `cursorViewportInteractionKind` when the viewport string is unchanged.
 * Native still dumps (or hits its own cache); this only avoids re-scanning
 * a large TUI screen on the 250ms poll.
 */
export function createViewportKindCache(
  kindOf: (
    text: string
  ) => CursorInteractionKind | null = cursorViewportInteractionKind
): ViewportKindCache {
  const lastKind = new Map<string, CursorInteractionKind | null>();
  const lastText = new Map<string, string>();
  return {
    clear(key) {
      lastKind.delete(key);
      lastText.delete(key);
    },
    clearAll() {
      lastKind.clear();
      lastText.clear();
    },
    kindFor(key, text) {
      if (lastText.get(key) === text) {
        return lastKind.get(key) ?? null;
      }
      const kind = kindOf(text);
      lastKind.set(key, kind);
      lastText.set(key, text);
      return kind;
    },
    rekey(from, to) {
      if (from === to) {
        return;
      }
      const hasKind = lastKind.has(from);
      const hasText = lastText.has(from);
      const kind = lastKind.get(from);
      const text = lastText.get(from);
      lastKind.delete(from);
      lastText.delete(from);
      if (hasKind) {
        lastKind.set(to, kind ?? null);
      }
      if (hasText && text !== undefined) {
        lastText.set(to, text);
      }
    },
  };
}
