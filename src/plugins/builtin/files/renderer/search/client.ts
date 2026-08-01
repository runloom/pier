/**
 * Debounced content query client — mirrors files-path-query-client for
 * content-search owners.
 */
import type { RendererPluginFilesFacade } from "@plugins/api/renderer-facades.ts";
import type {
  FileContentQueryItem,
  FileQueryEvent,
} from "@shared/contracts/file/query.ts";
import type { FilesContentSearchConditions } from "./params.ts";

const DEFAULT_DEBOUNCE_MS = 200;

export type FilesContentQueryClientFacade = Pick<
  RendererPluginFilesFacade,
  "onPathQueryEvent" | "queryContents"
>;

export interface ContentQuerySnapshot {
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly items: readonly FileContentQueryItem[];
  readonly status: "idle" | "loading" | "done" | "error";
  readonly truncated: boolean;
}

export interface FilesContentQueryClient {
  search(input: {
    conditions: FilesContentSearchConditions;
    debounceMs?: number;
    excludePatterns?: string;
    onUpdate: (snap: ContentQuerySnapshot) => void;
    owner: string;
  }): () => void;
}

interface ActiveSession {
  cancelHandle: (() => void) | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  items: FileContentQueryItem[];
  onUpdate: (snap: ContentQuerySnapshot) => void;
  queryId: string | null;
  unsubscribe: (() => void) | null;
}

export function createFilesContentQueryClient(
  files: FilesContentQueryClientFacade
): FilesContentQueryClient {
  let active: ActiveSession | null = null;

  function teardown(session: ActiveSession): void {
    if (session.debounceTimer !== null) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = null;
    }
    if (session.unsubscribe !== null) {
      session.unsubscribe();
      session.unsubscribe = null;
    }
    if (session.cancelHandle !== null) {
      session.cancelHandle();
      session.cancelHandle = null;
    }
    session.disposed = true;
  }

  function fire(
    session: ActiveSession,
    input: {
      conditions: FilesContentSearchConditions;
      excludePatterns?: string;
      onUpdate: (snap: ContentQuerySnapshot) => void;
      owner: string;
    }
  ): void {
    if (session.disposed) {
      return;
    }
    if (session.unsubscribe !== null) {
      session.unsubscribe();
      session.unsubscribe = null;
    }
    if (session.cancelHandle !== null) {
      session.cancelHandle();
      session.cancelHandle = null;
    }
    session.items = [];
    session.onUpdate = input.onUpdate;

    const { conditions } = input;
    if (conditions.query.trim().length === 0) {
      session.queryId = null;
      session.onUpdate({
        items: [],
        status: "idle",
        truncated: false,
      });
      return;
    }

    session.onUpdate({
      items: [],
      status: "loading",
      truncated: false,
    });

    session.unsubscribe = files.onPathQueryEvent((event) => {
      onEvent(session, event);
    });

    const handle = files.queryContents({
      owner: input.owner,
      query: conditions.query,
      root: conditions.root,
      options: {
        applyExcludePatterns: conditions.applyExcludePatterns,
        applyGitIgnore: conditions.applyGitIgnore,
        caseSensitive: conditions.caseSensitive,
        ...(input.excludePatterns === undefined
          ? {}
          : { excludePatterns: input.excludePatterns }),
        ...(conditions.include.trim().length > 0
          ? { include: conditions.include.trim() }
          : {}),
        regexp: conditions.regexp,
        ...(conditions.scopeDir ? { scopeDir: conditions.scopeDir } : {}),
        wholeWord: conditions.wholeWord,
      },
    });
    session.queryId = handle.queryId;
    session.cancelHandle = () => {
      handle.cancel();
    };

    handle.started
      .then((ok) => {
        if (session.disposed || session.queryId !== handle.queryId) {
          return;
        }
        if (ok === false) {
          session.cancelHandle = null;
          teardown(session);
          session.onUpdate({
            errorCode: "start-rejected",
            errorMessage: "Unable to start content search",
            items: [],
            status: "error",
            truncated: false,
          });
        }
      })
      .catch((error: unknown) => {
        if (session.disposed || session.queryId !== handle.queryId) {
          return;
        }
        session.cancelHandle = null;
        teardown(session);
        session.onUpdate({
          errorCode: "start-failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Unable to start content search",
          items: [],
          status: "error",
          truncated: false,
        });
      });
  }

  function onEvent(session: ActiveSession, event: FileQueryEvent): void {
    if (session.disposed || event.queryId !== session.queryId) {
      return;
    }
    switch (event.kind) {
      case "started":
        return;
      case "batch":
        if (event.mode !== "content") {
          return;
        }
        for (const item of event.items) {
          session.items.push(item);
        }
        session.onUpdate({
          items: session.items.slice(),
          status: "loading",
          truncated: false,
        });
        return;
      case "done": {
        const items = session.items.slice();
        session.cancelHandle = null;
        teardown(session);
        session.onUpdate({
          items,
          status: "done",
          truncated: event.truncated,
        });
        return;
      }
      case "error": {
        session.cancelHandle = null;
        teardown(session);
        session.onUpdate({
          errorCode: event.code,
          errorMessage: event.message,
          items: session.items.slice(),
          status: "error",
          truncated: false,
        });
        return;
      }
      default:
        return;
    }
  }

  return {
    search(input) {
      if (active && !active.disposed) {
        teardown(active);
      }
      const session: ActiveSession = {
        cancelHandle: null,
        debounceTimer: null,
        disposed: false,
        items: [],
        onUpdate: input.onUpdate,
        queryId: null,
        unsubscribe: null,
      };
      active = session;

      const debounceMs = input.debounceMs ?? DEFAULT_DEBOUNCE_MS;
      // Immediate idle when empty query; debounce non-empty typing.
      if (input.conditions.query.trim().length === 0) {
        fire(session, input);
      } else {
        session.onUpdate({
          items: [],
          status: "loading",
          truncated: false,
        });
        session.debounceTimer = setTimeout(() => {
          session.debounceTimer = null;
          fire(session, input);
        }, debounceMs);
      }

      return () => {
        if (active === session) {
          active = null;
        }
        teardown(session);
      };
    },
  };
}
