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

  it("does not recurse files.list for search and ranks theme.ts via path query", async () => {
    const query = createFakeQueryFacade();
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_requestOrRoot, options) => {
        const path = options?.path ?? "";
        if (path === "") {
          return [directory("src"), file("README.md")];
        }
        if (path === "src") {
          return [directory("src/plugins")];
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
            file("src/plugins/builtin/files/renderer/other.ts"),
          ];
        }
        return [];
      }
    );
    const context = createContext(query, list);
    const treeApiRef = createRef<PierFileTreeApi | null>();
    const setSearch = vi.fn();
    treeApiRef.current = {
      setSearch,
      revealPath: vi.fn(),
    } as unknown as PierFileTreeApi;
    const onOpenFile = vi.fn();

    await loadFilesTreeRoot(ROOT, list, "Failed to load files");
    const listCallsAfterRoot = list.mock.calls.length;

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed to load files",
        instanceId: "tree-1",
        list,
        onOpenFile,
        root: ROOT,
        searchFailedTitle: "Unable to search",
        treeApiRef,
      })
    );

    act(() => {
      result.current.openSearch();
      result.current.changeSearch("theme.ts");
    });

    // Clear Pierre setSearch as primary matcher.
    expect(setSearch).toHaveBeenCalledWith(null);

    expect(result.current.loading).toBe(true);
    expect(result.current.showResultLayer).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    expect(query.starts).toHaveLength(1);
    expect(query.starts[0]?.query).toBe("theme.ts");
    expect(query.starts[0]?.owner.startsWith("tree-search:")).toBe(true);
    // Search must not walk the tree via list.
    expect(list.mock.calls.length).toBe(listCallsAfterRoot);

    const queryId = query.starts[0]?.queryId ?? "";
    act(() => {
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
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.items.map((item) => item.path)).toEqual([
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
      "src/theme.ts",
    ]);
    expect(result.current.matchCount).toBe(2);
    expect(result.current.matchText).toBe("2");

    act(() => {
      query.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: false,
        scanned: 40,
        elapsedMs: 5,
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBe("done");
    expect(result.current.items[0]?.path).toBe(
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
    );
  });

  it("shows empty only after done with zero items and surfaces truncated 200+", async () => {
    const query = createFakeQueryFacade();
    const list = vi.fn(async () => [] as FileEntry[]);
    const context = createContext(query, list);
    const treeApiRef = createRef<PierFileTreeApi | null>();
    treeApiRef.current = {
      setSearch: vi.fn(),
      revealPath: vi.fn(),
    } as unknown as PierFileTreeApi;

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-2",
        list,
        onOpenFile: vi.fn(),
        root: ROOT,
        searchFailedTitle: "Unable to search",
        treeApiRef,
      })
    );

    act(() => {
      result.current.openSearch();
      result.current.changeSearch("zzz");
    });

    expect(result.current.hasNoResults).toBe(false);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const queryId = query.starts[0]?.queryId ?? "";

    act(() => {
      query.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: false,
        scanned: 0,
        elapsedMs: 1,
      });
    });
    expect(result.current.hasNoResults).toBe(true);
    expect(result.current.matchText).toBe("0");

    act(() => {
      result.current.changeSearch("theme");
    });
    expect(result.current.hasNoResults).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const secondId = query.starts.at(-1)?.queryId ?? "";
    const many = Array.from({ length: 200 }, (_, index) => ({
      path: `file-${index}.ts`,
      score: 200 - index,
    }));
    act(() => {
      query.emit({ kind: "batch", queryId: secondId, items: many });
      query.emit({
        kind: "done",
        queryId: secondId,
        reason: "completed",
        truncated: true,
        scanned: 5000,
        elapsedMs: 12,
      });
    });

    expect(result.current.truncated).toBe(true);
    expect(result.current.matchCount).toBe(200);
    expect(result.current.matchText).toBe("200+");
    expect(result.current.hasNoResults).toBe(false);
  });

  it("opens focused result and loads only ancestor directories", async () => {
    const query = createFakeQueryFacade();
    const listedPaths: string[] = [];
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_requestOrRoot, options) => {
        const path = options?.path ?? "";
        listedPaths.push(path);
        if (path === "") {
          return [directory("src")];
        }
        if (path === "src") {
          return [directory("src/plugins")];
        }
        if (path === "src/plugins") {
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
    const treeApiRef = createRef<PierFileTreeApi | null>();
    const revealPath = vi.fn();
    treeApiRef.current = {
      setSearch: vi.fn(),
      revealPath,
    } as unknown as PierFileTreeApi;
    const onOpenFile = vi.fn();

    await loadFilesTreeRoot(ROOT, list, "Failed");
    listedPaths.length = 0;

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-3",
        list,
        onOpenFile,
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
    const queryId = query.starts[0]?.queryId ?? "";
    act(() => {
      query.emit({
        kind: "batch",
        queryId,
        items: [
          {
            path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
            score: 99,
          },
        ],
      });
      query.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: false,
        scanned: 10,
        elapsedMs: 2,
      });
    });

    await act(async () => {
      await result.current.openFocusedMatch();
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "file",
        path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
        root: ROOT,
      }),
      undefined
    );
    // Ancestors only — never a recursive whole-tree walk of siblings.
    expect(listedPaths.every((path) => path !== "")).toBe(true);
    expect(listedPaths).toEqual(
      expect.arrayContaining([
        "src",
        "src/plugins",
        "src/plugins/builtin",
        "src/plugins/builtin/files",
        "src/plugins/builtin/files/renderer",
      ])
    );
    expect(listedPaths).not.toContain("src/plugins/other-sibling");
    expect(revealPath).toHaveBeenCalledWith(
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
    );
    // Ancestor-only loads: never recursive sibling discovery.
    expect(listedPaths.filter((path) => path.startsWith("src")).length).toBe(
      listedPaths.length
    );
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src")).toBe(true);
    expect(snapshot.entriesByPath.has("src/plugins")).toBe(true);
  });

  it("forwards MRU hints for empty query while search is open", async () => {
    const query = createFakeQueryFacade();
    const list = vi.fn(async () => [] as FileEntry[]);
    const context = createContext(query, list);
    const treeApiRef = createRef<PierFileTreeApi | null>();
    treeApiRef.current = {
      setSearch: vi.fn(),
      revealPath: vi.fn(),
    } as unknown as PierFileTreeApi;

    recordFilesPathMru(ROOT, "src/a.ts");

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-4",
        list,
        onOpenFile: vi.fn(),
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
    const treeApiRef = createRef<PierFileTreeApi | null>();
    treeApiRef.current = {
      setSearch: vi.fn(),
      revealPath: vi.fn(),
    } as unknown as PierFileTreeApi;

    const { result } = renderHook(() =>
      useFilesTreeSearch({
        context,
        fallbackError: "Failed",
        instanceId: "tree-5",
        list,
        onOpenFile: vi.fn(),
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
