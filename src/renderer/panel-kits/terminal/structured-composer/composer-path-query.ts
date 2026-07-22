import type {
  FilePathQueryItem,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";

const DEFAULT_DEBOUNCE_MS = 80;
const DEFAULT_LIMIT = 40;

export type ComposerPathQueryStatus = "idle" | "loading" | "done" | "error";

export interface ComposerPathQuerySnapshot {
  errorMessage?: string;
  items: readonly FilePathQueryItem[];
  status: ComposerPathQueryStatus;
}

/**
 * Debounced file path query for the composer @ menu.
 * Uses host `window.pier.fileQuery` (not the files plugin facade).
 */
export function createComposerPathQueryClient(): {
  dispose: () => void;
  search: (input: {
    onUpdate: (snap: ComposerPathQuerySnapshot) => void;
    query: string;
    root: string;
  }) => () => void;
} {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let queryId: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  let items: FilePathQueryItem[] = [];

  function clearTimer(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function cancelInFlight(): void {
    clearTimer();
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (queryId) {
      window.pier.fileQuery.cancel(queryId).catch(() => undefined);
      queryId = null;
    }
    items = [];
  }

  function search(input: {
    onUpdate: (snap: ComposerPathQuerySnapshot) => void;
    query: string;
    root: string;
  }): () => void {
    if (disposed) {
      return () => undefined;
    }
    cancelInFlight();
    input.onUpdate({ items: [], status: "loading" });

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (disposed) {
        return;
      }
      const nextId = crypto.randomUUID();
      queryId = nextId;
      items = [];

      unsubscribe = window.pier.fileQuery.onEvent((event: FileQueryEvent) => {
        if (disposed || event.queryId !== nextId) {
          return;
        }
        if (event.kind === "batch") {
          items = [...items, ...event.items];
          input.onUpdate({ items: [...items], status: "loading" });
          return;
        }
        if (event.kind === "done") {
          input.onUpdate({ items: [...items], status: "done" });
          return;
        }
        if (event.kind === "error") {
          input.onUpdate({
            errorMessage: event.message,
            items: [],
            status: "error",
          });
        }
      });

      window.pier.fileQuery
        .start({
          limit: DEFAULT_LIMIT,
          owner: `terminal-composer-mention:${nextId}`,
          query: input.query,
          queryId: nextId,
          root: input.root,
        })
        .then((ok) => {
          if (!ok && queryId === nextId) {
            input.onUpdate({
              errorMessage: "query failed",
              items: [],
              status: "error",
            });
          }
        })
        .catch((error: unknown) => {
          if (queryId === nextId) {
            input.onUpdate({
              errorMessage:
                error instanceof Error ? error.message : String(error),
              items: [],
              status: "error",
            });
          }
        });
    }, DEFAULT_DEBOUNCE_MS);

    return () => {
      cancelInFlight();
    };
  }

  return {
    dispose: () => {
      disposed = true;
      cancelInFlight();
    },
    search,
  };
}

export function joinProjectPath(
  root: string,
  relativePosix: string
): string | null {
  const base = root.replace(/\/+$/, "");
  const parts = relativePosix.replace(/^\/+/, "").split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      if (stack.length === 0) {
        return null;
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0 ? base : `${base}/${stack.join("/")}`;
}

export function mentionLabelFromRelativePath(relativePosix: string): string {
  const parts = relativePosix.split("/").filter(Boolean);
  return parts.at(-1) ?? relativePosix;
}
