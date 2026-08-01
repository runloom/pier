import type {
  FileContentQueryItem,
  FileQueryEvent,
} from "@shared/contracts/file/query.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilesContentQueryClient } from "../../../../../src/plugins/builtin/files/renderer/search/client.ts";
import type { FilesContentSearchConditions } from "../../../../../src/plugins/builtin/files/renderer/search/params.ts";

type Listener = (event: FileQueryEvent) => void;

function createFakeFacade() {
  const listeners = new Set<Listener>();
  const starts: { owner: string; query: string }[] = [];
  return {
    starts,
    emit(event: FileQueryEvent) {
      for (const listener of listeners) listener(event);
    },
    facade: {
      onPathQueryEvent(listener: Listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      queryContents(request: {
        owner: string;
        query: string;
        root: string;
        queryId?: string;
      }) {
        const queryId = request.queryId ?? `q-${starts.length + 1}`;
        starts.push({ owner: request.owner, query: request.query });
        return {
          cancel: vi.fn(),
          queryId,
          started: Promise.resolve(true),
        };
      },
    },
  };
}

const baseConditions = (
  patch: Partial<FilesContentSearchConditions> = {}
): FilesContentSearchConditions => ({
  applyExcludePatterns: true,
  applyGitIgnore: true,
  caseSensitive: false,
  include: "",
  query: "TODO",
  regexp: false,
  root: "/repo",
  scopeDir: undefined,
  wholeWord: false,
  ...patch,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createFilesContentQueryClient", () => {
  it("debounces and accumulates content batches", async () => {
    vi.useFakeTimers();
    const env = createFakeFacade();
    const client = createFilesContentQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({
      conditions: baseConditions(),
      onUpdate,
      owner: "content-search:p1",
    });
    expect(env.starts).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(env.starts).toHaveLength(1);
    const queryId = "q-1";
    const hit: FileContentQueryItem = {
      path: "a.ts",
      line: 1,
      matchCharStart: 0,
      matchCharEnd: 4,
      matchByteStart: 0,
      matchByteEnd: 4,
      preview: "TODO",
      previewMatchStart: 0,
      previewMatchEnd: 4,
    };
    env.emit({ kind: "started", queryId });
    env.emit({
      kind: "batch",
      mode: "content",
      queryId,
      items: [hit],
    });
    env.emit({
      kind: "done",
      queryId,
      reason: "completed",
      truncated: false,
      scanned: 1,
      elapsedMs: 2,
    });
    const last = onUpdate.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      status: "done",
      items: [hit],
      truncated: false,
    });
  });

  it("ignores path-mode batches on the shared bus", () => {
    vi.useFakeTimers();
    const env = createFakeFacade();
    const client = createFilesContentQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({
      conditions: baseConditions(),
      onUpdate,
      owner: "content-search:p1",
    });
    vi.advanceTimersByTime(200);
    env.emit({
      kind: "batch",
      mode: "path",
      queryId: "q-1",
      items: [{ path: "a.ts", score: 1 }],
    });
    const mid = onUpdate.mock.calls.flatMap((c) => c[0].items);
    expect(mid).toEqual([]);
  });

  it("empty query stays idle without start", () => {
    const env = createFakeFacade();
    const client = createFilesContentQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({
      conditions: baseConditions({ query: "   " }),
      onUpdate,
      owner: "content-search:p1",
    });
    expect(env.starts).toHaveLength(0);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "idle", items: [] })
    );
  });
});
