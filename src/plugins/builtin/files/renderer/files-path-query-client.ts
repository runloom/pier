/**
 * Files path query client — debounced start/cancel + snapshot fan-out.
 *
 * Consumers (quick-open, tree search) drive one client per session. `search`
 * debounces walks by 80 ms, cancels the in-flight walk on every new call, and
 * filters stray events by `queryId` so a late batch from a cancelled walk can
 * never leak into a fresh snapshot (design §5.1, §4.4).
 */
import type { RendererPluginFilesFacade } from "@plugins/api/renderer-facades.ts";
import type {
  FilePathQueryItem,
  FilePathQueryStart,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import { listFilesPathMru } from "./files-quick-open-mru.ts";

const DEFAULT_DEBOUNCE_MS = 80;

export type FilesPathQueryClientFacade = Pick<
  RendererPluginFilesFacade,
  "onPathQueryEvent" | "queryPaths"
>;

export interface PathQuerySnapshot {
  readonly errorMessage?: string;
  readonly items: readonly FilePathQueryItem[];
  readonly status: "idle" | "loading" | "done" | "error";
  readonly truncated: boolean;
}

export interface FilesPathQuerySearchInput {
  debounceMs?: number;
  /** Full multiline exclude source (tree setting). Omitted → main defaults. */
  excludePatterns?: string;
  onUpdate: (snap: PathQuerySnapshot) => void;
  owner: string;
  query: string;
  root: string;
}

export interface FilesPathQueryClient {
  search(input: FilesPathQuerySearchInput): () => void;
}

interface ActiveSession {
  cancelHandle: (() => void) | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  items: FilePathQueryItem[];
  onUpdate: (snap: PathQuerySnapshot) => void;
  queryId: string | null;
  unsubscribe: (() => void) | null;
}

export function createFilesPathQueryClient(
  files: FilesPathQueryClientFacade
): FilesPathQueryClient {
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
    input: FilesPathQuerySearchInput
  ): void {
    if (session.disposed) {
      return;
    }
    session.debounceTimer = null;

    const request: Omit<FilePathQueryStart, "queryId"> & { queryId?: string } =
      {
        limit: 200,
        mruPaths: [...listFilesPathMru(input.root)],
        options: {
          applyExcludePatterns: true,
          applyGitIgnore: true,
          ...(input.excludePatterns === undefined
            ? {}
            : { excludePatterns: input.excludePatterns }),
        },
        owner: input.owner,
        query: input.query,
        root: input.root,
      };

    // Subscribe before start so a fast main-process started/batch cannot race
    // past the listener install (especially once started is awaited).
    session.unsubscribe = files.onPathQueryEvent((event) => {
      onEvent(session, event);
    });
    const handle = files.queryPaths(request);
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
            errorMessage: "Unable to start file path query",
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
          errorMessage:
            error instanceof Error
              ? error.message
              : "Unable to start file path query",
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
        // done arrived — no cancel needed, drop the handle first so
        // teardown does not try to cancel a completed walk.
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
          errorMessage: event.message,
          items: [],
          status: "error",
          truncated: false,
        });
        return;
      }
      default:
        return;
    }
  }

  function search(input: FilesPathQuerySearchInput): () => void {
    if (active !== null) {
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

    session.onUpdate({ items: [], status: "loading", truncated: false });
    session.debounceTimer = setTimeout(() => {
      fire(session, input);
    }, input.debounceMs ?? DEFAULT_DEBOUNCE_MS);

    return () => {
      teardown(session);
      if (active === session) {
        active = null;
      }
    };
  }

  return { search };
}
