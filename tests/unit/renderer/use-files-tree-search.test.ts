import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  __resetFilesPathMruForTests,
  recordFilesPathMru,
} from "@plugins/builtin/files/renderer/files-quick-open-mru.ts";
import {
  clearFilesTreeStore,
  getFilesTreeSnapshot,
  loadFilesTreeRoot,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
import { useFilesTreeSearch } from "@plugins/builtin/files/renderer/use-files-tree-search.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type {
  FilePathQueryStart,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = "/repo";

type Listener = (event: FileQueryEvent) => void;

function createFakeQueryFacade() {
  const listeners = new Set<Listener>();
  const starts: FilePathQueryStart[] = [];
  const cancels: string[] = [];
  let nextId = 0;

  return {
    cancels,
    starts,
    emit(event: FileQueryEvent) {
      for (const listener of Array.from(listeners)) {
        listener(event);
      }
    },
    onPathQueryEvent(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    queryPaths(
      request: Omit<FilePathQueryStart, "queryId"> & { queryId?: string }
    ) {
      nextId += 1;
      const queryId = request.queryId ?? `q${nextId}`;
      starts.push({ ...request, queryId } as FilePathQueryStart);
      return {
        cancel: () => {
          cancels.push(queryId);
        },
        queryId,
        started: Promise.resolve(true),
      };
    },
  };
}

function file(path: string): FileEntry {
  return { kind: "file", path, root: ROOT };
}

function directory(path: string): FileEntry {
  return { kind: "directory", path, root: ROOT };
}

function createContext(
  query: ReturnType<typeof createFakeQueryFacade>,
  list: RendererPluginContext["files"]["list"]
): RendererPluginContext {
  return {
    configuration: {
      get: vi.fn((key: string) => {
        if (key === "pier.files.tree.excludePatterns") {
          return "**/custom-build";
        }
        return;
      }),
      onDidChange: vi.fn(() => () => undefined),
    },
    dialogs: {
      alert: vi.fn(async () => undefined),
      choice: vi.fn(async () => "confirm" as const),
      confirm: vi.fn(async () => true),
      prompt: vi.fn(async () => null),
    },
    files: {
      list,
      onPathQueryEvent: query.onPathQueryEvent.bind(query),
      queryPaths: query.queryPaths.bind(query),
    },
    i18n: {
      language: () => "en",
      t: (_key: string, _values?: unknown, fallback?: string) => fallback ?? "",
    },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(() => ({
        dismiss: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      })),
      success: vi.fn(),
      system: vi.fn(async () => ({ shown: true })),
    },
  } as unknown as RendererPluginContext;
}

function mockTreeApi(setSearch = vi.fn()) {
  const treeApiRef = createRef<PierFileTreeApi | null>();
  treeApiRef.current = {
    activateFocusedSearchMatch: vi.fn(() => true),
    focusSearchMatch: vi.fn(),
    getSearchMatchCount: vi.fn(() => 0),
    revealPath: vi.fn(),
    setSearch,
  } as unknown as PierFileTreeApi;
  return { setSearch, treeApiRef };
}

describe("useFilesTreeSearch path query", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetFilesPathMruForTests();
    clearFilesTreeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearFilesTreeStore();
    vi.restoreAllMocks();
  });

  it("path-queries theme.ts, materializes ancestors, and re-applies setSearch", async () => {
    const query = createFakeQueryFacade();
    const listedPaths: string[] = [];
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_requestOrRoot, options) => {
        const path = options?.path ?? "";
        listedPaths.push(path);
        if (path === "") {
          return [directory("src"), file("README.md")];
        }
        if (path === "src") {
          return [directory("src/plugins"), directory("src/other")];
        }
        if (path === "src/plugins") {
          return [directory("src/plugins/builtin")];
        }
        if (path === "src/plugins/builtin") {
          return [directory("src/plugins/builtin/files")];
        }
        if (path === "src/plugins/builtin/files") {
          return [directory("src/plugins/builtin/files/renderer")];
        }
        if (path === "src/plugins/builtin/files/renderer") {
          return [
            file(
              "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
            ),
          ];
        }
        return [];
      }
    );
    const context = createContext(query, list);
    const { setSearch, treeApiRef } = mockTreeApi();

    await loadFilesTreeRoot(ROOT, list, "Failed to load files");
    listedPaths.length = 0;

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed to load files",
        instanceId: "tree-1",
        list,
        root: ROOT,
        searchFailedTitle: "Unable to search",
        treeApiRef,
      })
    );

    act(() => {
      result.current.openSearch();
      result.current.changeSearch("theme.ts");
    });

    expect(result.current.loading).toBe(true);
    expect(result.current).not.toHaveProperty("showResultLayer");

    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    expect(query.starts).toHaveLength(1);
    expect(query.starts[0]?.query).toBe("theme.ts");
    expect(query.starts[0]?.owner.startsWith("tree-search:")).toBe(true);

    const queryId = query.starts[0]?.queryId ?? "";
    await act(async () => {
      query.emit({
        kind: "batch",
        queryId,
        items: [
          {
            path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
            score: 100,
          },
          { path: "src/theme.ts", score: 10 },
        ],
      });
      query.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: false,
        scanned: 40,
        elapsedMs: 5,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.matchCount).toBe(2);
    expect(result.current.matchText).toBe("2");
    expect(listedPaths).not.toContain("src/other");
    expect(listedPaths).toEqual(
      expect.arrayContaining([
        "src",
        "src/plugins",
        "src/plugins/builtin",
        "src/plugins/builtin/files",
        "src/plugins/builtin/files/renderer",
      ])
    );
    expect(setSearch).toHaveBeenCalledWith("theme.ts");
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src")).toBe(true);
    expect(snapshot.entriesByPath.has("src/plugins")).toBe(true);
  });

  it("keeps matchCount 0 until done empty, and shows 200+ when truncated", async () => {
    const query = createFakeQueryFacade();
    const list = vi.fn(async () => [] as FileEntry[]);
    const context = createContext(query, list);
    const { treeApiRef } = mockTreeApi();

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-2",
        list,
        root: ROOT,
        searchFailedTitle: "Unable to search",
        treeApiRef,
      })
    );

    act(() => {
      result.current.openSearch();
      result.current.changeSearch("zzz");
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.matchCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const queryId = query.starts[0]?.queryId ?? "";

    await act(async () => {
      query.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: false,
        scanned: 0,
        elapsedMs: 1,
      });
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.matchCount).toBe(0);
    expect(result.current.matchText).toBe("0");

    act(() => {
      result.current.changeSearch("theme");
    });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const secondId = query.starts.at(-1)?.queryId ?? "";
    const many = Array.from({ length: 200 }, (_, index) => ({
      path: `file-${index}.ts`,
      score: 200 - index,
    }));
    await act(async () => {
      query.emit({ kind: "batch", queryId: secondId, items: many });
      query.emit({
        kind: "done",
        queryId: secondId,
        reason: "completed",
        truncated: true,
        scanned: 5000,
        elapsedMs: 12,
      });
      await Promise.resolve();
    });

    expect(result.current.truncated).toBe(true);
    expect(result.current.matchCount).toBe(200);
    expect(result.current.matchText).toBe("200+");
  });

  it("forwards MRU hints for empty query while search is open", async () => {
    const query = createFakeQueryFacade();
    const list = vi.fn(async () => [] as FileEntry[]);
    const context = createContext(query, list);
    const { treeApiRef } = mockTreeApi();

    recordFilesPathMru(ROOT, "src/a.ts");

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-4",
        list,
        root: ROOT,
        searchFailedTitle: "Unable to search",
        treeApiRef,
      })
    );

    act(() => {
      result.current.openSearch();
    });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    expect(query.starts).toHaveLength(1);
    expect(query.starts[0]?.query).toBe("");
    expect(query.starts[0]?.mruPaths).toEqual(["src/a.ts"]);
  });

  it("passes pier.files.tree.excludePatterns into the path query", async () => {
    const query = createFakeQueryFacade();
    const list = vi.fn(async () => [] as FileEntry[]);
    const context = createContext(query, list);
    const { treeApiRef } = mockTreeApi();

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-5",
        list,
        root: ROOT,
        searchFailedTitle: "Unable to search",
        treeApiRef,
      })
    );

    act(() => {
      result.current.openSearch();
      result.current.changeSearch("theme");
    });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    expect(query.starts[0]?.options?.excludePatterns).toBe("**/custom-build");
  });
});
