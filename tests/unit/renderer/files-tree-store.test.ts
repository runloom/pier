import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  clearFileTreeSidebarCache,
  registerPendingCreate,
} from "@plugins/builtin/files/renderer/files-tree-registry.ts";
import {
  addFilesTreeEntry,
  clearFilesTreeStore,
  ensureAncestorDirectoryEntries,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  loadFilesTreeDirectoryWithDiscovery,
  loadFilesTreeRoot,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
  removeFilesTreeEntry,
  subscribeFilesTreeSession,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
import { reloadFilesTreeVisibility } from "@plugins/builtin/files/renderer/files-tree-visibility-reload.ts";
import { applyFilesTreeWatchEvent } from "@plugins/builtin/files/renderer/files-tree-watch-events.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/repo";

type FilesListApi = RendererPluginContext["files"]["list"];

function file(path: string): FileEntry {
  return { kind: "file", path, root: ROOT };
}

function directory(path: string): FileEntry {
  return { kind: "directory", path, root: ROOT };
}

function listFromResponses(
  responsesByPath: Readonly<Record<string, readonly FileEntry[]>>
): FilesListApi {
  return vi.fn<FilesListApi>((requestOrRoot, options) => {
    const path =
      typeof requestOrRoot === "string"
        ? (options?.path ?? "")
        : requestOrRoot.path;
    return Promise.resolve([...(responsesByPath[path] ?? [])]);
  });
}

async function settleStorePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function loadRoot(entries: readonly FileEntry[]): Promise<void> {
  loadFilesTreeRoot(
    ROOT,
    listFromResponses({ "": entries }),
    "Failed to load files"
  );
  await settleStorePromises();
  expect(getFilesTreeSnapshot(ROOT).rootLoaded).toBe(true);
}

describe("files-tree-store", () => {
  afterEach(() => {
    clearFilesTreeStore();
    clearFileTreeSidebarCache();
    vi.restoreAllMocks();
  });

  it("returns an unloaded empty snapshot when no project root is selected", () => {
    const snapshot = getFilesTreeSnapshot(null);

    expect(snapshot.rootLoaded).toBe(false);
    expect(snapshot.rootLoading).toBe(false);
    expect(snapshot.rootError).toBeNull();
    expect(snapshot.entriesByPath.size).toBe(0);
    expect(snapshot.directoryStatesByPath.size).toBe(0);
  });

  it("records a root load error without leaving the root loading", async () => {
    const list = vi.fn<FilesListApi>(() =>
      Promise.reject(new Error("Permission denied"))
    );

    loadFilesTreeRoot(ROOT, list, "Failed to load files");
    await settleStorePromises();

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.rootLoaded).toBe(true);
    expect(snapshot.rootLoading).toBe(false);
    expect(snapshot.rootError).toBe("Permission denied");
    expect(snapshot.entriesByPath.size).toBe(0);
    expect(snapshot.directoryStatesByPath.size).toBe(0);
  });

  it("does not start a duplicate root request while the first root load is in flight", async () => {
    const rootLoad = createDeferred<FileEntry[]>();
    const firstList = vi.fn<FilesListApi>(() => rootLoad.promise);
    const secondList = vi.fn<FilesListApi>(() =>
      Promise.resolve([file("unexpected.ts")])
    );

    loadFilesTreeRoot(ROOT, firstList, "Failed to load files");
    loadFilesTreeRoot(ROOT, secondList, "Second load should not run");

    expect(firstList).toHaveBeenCalledTimes(1);
    expect(secondList).not.toHaveBeenCalled();
    expect(getFilesTreeSnapshot(ROOT).rootLoading).toBe(true);

    rootLoad.resolve([file("README.md")]);
    await settleStorePromises();

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.rootLoaded).toBe(true);
    expect(snapshot.rootLoading).toBe(false);
    expect(snapshot.entriesByPath.get("README.md")).toEqual(file("README.md"));
    expect(snapshot.entriesByPath.has("unexpected.ts")).toBe(false);
  });

  it("marks a failed directory load as an error while preserving existing entries", async () => {
    const readme = file("README.md");
    await loadRoot([directory("src"), readme]);
    const list = vi.fn<FilesListApi>(() =>
      Promise.reject(new Error("Network unavailable"))
    );

    const result = await loadFilesTreeDirectory(ROOT, "src", list);

    expect(result).toEqual({ error: expect.any(Error), ok: false });
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("error");
    expect(snapshot.entriesByPath.get("README.md")).toBe(readme);
    expect(snapshot.entriesByPath.get("src")).toEqual(directory("src"));
    expect(snapshot.rootError).toBeNull();
  });

  it("reports a rejected directory load even when the rejection has no value", async () => {
    await loadRoot([directory("src")]);

    const result = await loadFilesTreeDirectory(ROOT, "src", () =>
      Promise.reject()
    );

    expect(result).toEqual({ error: undefined, ok: false });
    expect(getFilesTreeSnapshot(ROOT).directoryStatesByPath.get("src")).toBe(
      "error"
    );
  });

  it("transitions a directory from loading to loaded when entries arrive", async () => {
    await loadRoot([directory("src")]);
    const directoryLoad = createDeferred<FileEntry[]>();
    const list = vi.fn<FilesListApi>(() => directoryLoad.promise);

    const loadPromise = loadFilesTreeDirectory(ROOT, "src", list);

    expect(getFilesTreeSnapshot(ROOT).directoryStatesByPath.get("src")).toBe(
      "loading"
    );

    directoryLoad.resolve([file("src/index.ts")]);
    await loadPromise;

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
    expect(snapshot.entriesByPath.get("src/index.ts")).toEqual(
      file("src/index.ts")
    );
  });

  it("shares one in-flight directory request across tree consumers", async () => {
    await loadRoot([directory("src")]);
    const directoryLoad = createDeferred<FileEntry[]>();
    const list = vi.fn<FilesListApi>(() => directoryLoad.promise);

    const firstLoad = loadFilesTreeDirectory(ROOT, "src", list);
    const secondLoad = loadFilesTreeDirectory(ROOT, "src", list);

    expect(list).toHaveBeenCalledTimes(1);
    directoryLoad.resolve([file("src/index.ts")]);
    await expect(firstLoad).resolves.toEqual({ ok: true });
    await expect(secondLoad).resolves.toEqual({ ok: true });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shares discovered directories with a search joining an active load", async () => {
    await loadRoot([directory("src")]);
    const directoryLoad = createDeferred<FileEntry[]>();
    const list = vi.fn<FilesListApi>(() => directoryLoad.promise);

    const regularLoad = loadFilesTreeDirectory(ROOT, "src", list);
    const searchLoad = loadFilesTreeDirectoryWithDiscovery(ROOT, "src", list);
    directoryLoad.resolve([directory("src/styles"), file("src/index.ts")]);

    await expect(regularLoad).resolves.toEqual({ ok: true });
    await expect(searchLoad).resolves.toEqual({
      discoveredDirectoryPaths: ["src/styles"],
      result: { ok: true },
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("loads an isolated directory chain atomically on the first expansion", async () => {
    await loadRoot([directory("src")]);
    const list = listFromResponses({
      src: [directory("src/generated")],
      "src/generated": [file("src/generated/index.ts")],
    });

    await loadFilesTreeDirectory(ROOT, "src", list);

    expect(list).toHaveBeenNthCalledWith(1, ROOT, { path: "src" });
    expect(list).toHaveBeenNthCalledWith(2, ROOT, { path: "src/generated" });
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.get("src/generated")).toBe("loaded");
    expect(snapshot.entriesByPath.get("src/generated/index.ts")).toEqual(
      file("src/generated/index.ts")
    );
  });

  it("stops notifying a listener after it unsubscribes", async () => {
    await loadRoot([directory("src")]);
    let notifications = 0;
    const unsubscribe = subscribeFilesTreeSession(ROOT, () => {
      notifications += 1;
    });

    unsubscribe();
    addFilesTreeEntry(ROOT, file("src/new.ts"));

    expect(notifications).toBe(0);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
  });

  it("marks an empty loaded parent as loaded after adding its first child", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(ROOT, "src", listFromResponses({ src: [] }));

    addFilesTreeEntry(ROOT, file("src/new.ts"));

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
    expect(snapshot.entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
  });

  it("marks a newly added directory entry as empty", () => {
    addFilesTreeEntry(ROOT, directory("src/components"));

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("src/components")).toEqual(
      directory("src/components")
    );
    expect(snapshot.directoryStatesByPath.get("src/components")).toBe("empty");
  });

  it("retains pending-create placeholders when a directory reload omits them", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/keep.ts")] })
    );
    addFilesTreeEntry(ROOT, file("src/untitled.ts"));
    registerPendingCreate({
      kind: "file",
      openAfter: true,
      placeholderPath: "src/untitled.ts",
      root: ROOT,
    });

    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/keep.ts")] })
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("src/keep.ts")).toEqual(
      file("src/keep.ts")
    );
    expect(snapshot.entriesByPath.get("src/untitled.ts")).toEqual(
      file("src/untitled.ts")
    );
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
  });

  it("marks a loaded parent as empty after removing its last child", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/only.ts")] })
    );

    removeFilesTreeEntry(ROOT, "src/only.ts");

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("empty");
    expect(snapshot.entriesByPath.has("src/only.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("src")).toEqual(directory("src"));
  });

  it("updates source and destination parent states when moving the only child into an empty parent", async () => {
    await loadRoot([directory("src"), directory("dest")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/only.ts")] })
    );
    await loadFilesTreeDirectory(ROOT, "dest", listFromResponses({ dest: [] }));

    moveFilesTreeEntry(ROOT, "src/only.ts", "dest/only.ts");

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("empty");
    expect(snapshot.directoryStatesByPath.get("dest")).toBe("loaded");
    expect(snapshot.entriesByPath.has("src/only.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("dest/only.ts")).toEqual(
      file("dest/only.ts")
    );
  });

  it("does not notify subscribers when reloading an already-loaded directory with an equivalent snapshot", async () => {
    const rootEntries = [directory("src"), file("README.md")];
    const srcEntries = [file("src/index.ts"), file("src/util.ts")];
    const list = listFromResponses({
      "": rootEntries,
      src: srcEntries,
    });
    let notifications = 0;
    const unsubscribe = subscribeFilesTreeSession(ROOT, () => {
      notifications += 1;
    });

    loadFilesTreeRoot(ROOT, list, "Failed to load files");
    await settleStorePromises();
    await loadFilesTreeDirectory(ROOT, "src", list);
    const notificationsAfterFirstLoad = notifications;
    const snapshotAfterFirstLoad = getFilesTreeSnapshot(ROOT);
    const srcIndexEntry =
      snapshotAfterFirstLoad.entriesByPath.get("src/index.ts");

    await loadFilesTreeDirectory(ROOT, "src", list);

    expect(notifications).toBe(notificationsAfterFirstLoad);
    expect(getFilesTreeSnapshot(ROOT).directoryStatesByPath.get("src")).toBe(
      "loaded"
    );
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/index.ts")).toBe(
      srcIndexEntry
    );
    unsubscribe();
  });

  it("reloads known directories in parent-first order when visibility changes", async () => {
    let hideMetadata = false;
    const responses: Readonly<Record<string, readonly FileEntry[]>> = {
      "": [directory(".git"), directory("src")],
      ".git": [file(".git/config")],
      src: [directory("src/cache"), file("src/index.ts")],
      "src/cache": [file("src/cache/generated.js")],
    };
    const list = vi.fn(async (_root: string, options?: { path?: string }) => {
      const entries = [...(responses[options?.path ?? ""] ?? [])];
      return hideMetadata
        ? entries.filter(
            (entry) =>
              !entry.path
                .split("/")
                .some((part) => [".git", "cache"].includes(part))
          )
        : entries;
    });

    await loadFilesTreeRoot(ROOT, list, "Failed to load files");
    await loadFilesTreeDirectory(ROOT, ".git", list);
    await loadFilesTreeDirectory(ROOT, "src", list);
    await loadFilesTreeDirectory(ROOT, "src/cache", list);
    hideMetadata = true;

    await reloadFilesTreeVisibility(ROOT, list, "Failed to load files");

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has(".git")).toBe(false);
    expect(snapshot.entriesByPath.has(".git/config")).toBe(false);
    expect(snapshot.directoryStatesByPath.has(".git")).toBe(false);
    expect(snapshot.entriesByPath.has("src/cache")).toBe(false);
    expect(snapshot.entriesByPath.has("src/cache/generated.js")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src/cache")).toBe(false);
    expect(snapshot.entriesByPath.get("src/index.ts")).toEqual(
      file("src/index.ts")
    );
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
  });

  it("queues a visibility reload behind an active root load", async () => {
    const initialRootLoad = createDeferred<void>();
    let showMetadata = true;
    let requestCount = 0;
    const list = vi.fn<FilesListApi>(async () => {
      requestCount += 1;
      const showMetadataForRequest = showMetadata;
      if (requestCount === 1) {
        await initialRootLoad.promise;
      }
      return showMetadataForRequest
        ? [directory(".git"), directory("src")]
        : [directory("src")];
    });

    const initialLoad = loadFilesTreeRoot(ROOT, list, "Failed to load files");
    showMetadata = false;
    const visibilityReload = reloadFilesTreeVisibility(
      ROOT,
      list,
      "Failed to load files"
    );
    initialRootLoad.resolve();
    await initialLoad;
    await visibilityReload;

    expect(list).toHaveBeenCalledTimes(2);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has(".git")).toBe(false);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src")).toBe(true);
  });

  it("applies the active visibility predicate to optimistic mutations", async () => {
    const list = Object.assign(async () => [file("README.md")], {
      isPathVisible: (_root: string, path: string) =>
        !path.split("/").includes(".git"),
    });
    await loadFilesTreeRoot(ROOT, list, "Failed to load files");

    addFilesTreeEntry(ROOT, directory(".git"));
    ensureAncestorDirectoryEntries(ROOT, ".git/hooks/pre-commit");
    addFilesTreeEntry(ROOT, file("src/index.ts"));
    moveFilesTreeEntry(ROOT, "src/index.ts", ".git/index.ts");

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has(".git")).toBe(false);
    expect(snapshot.entriesByPath.has(".git/hooks")).toBe(false);
    expect(snapshot.entriesByPath.has("src/index.ts")).toBe(false);
    expect(snapshot.entriesByPath.has(".git/index.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("README.md")).toEqual(file("README.md"));
  });

  it("preserves a loaded child directory subtree when reloading its parent", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({
        src: [file("src/index.ts"), directory("src/nested")],
      })
    );
    await loadFilesTreeDirectory(
      ROOT,
      "src/nested",
      listFromResponses({
        "src/nested": [file("src/nested/deep.ts")],
      })
    );

    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({
        src: [
          file("src/index.ts"),
          directory("src/nested"),
          file("src/reloaded.ts"),
        ],
      })
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("src/nested")).toEqual(
      directory("src/nested")
    );
    expect(snapshot.entriesByPath.get("src/nested/deep.ts")).toEqual(
      file("src/nested/deep.ts")
    );
    expect(snapshot.entriesByPath.get("src/reloaded.ts")).toEqual(
      file("src/reloaded.ts")
    );
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.get("src/nested")).toBe("loaded");
  });

  it("prunes a missing child directory subtree and its load states when reloading its parent", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({
        src: [directory("src/kept"), directory("src/removed")],
      })
    );
    await loadFilesTreeDirectory(
      ROOT,
      "src/kept",
      listFromResponses({
        "src/kept": [file("src/kept/still-here.ts")],
      })
    );
    await loadFilesTreeDirectory(
      ROOT,
      "src/removed",
      listFromResponses({
        "src/removed": [
          file("src/removed/old.ts"),
          directory("src/removed/nested"),
        ],
      })
    );
    await loadFilesTreeDirectory(
      ROOT,
      "src/removed/nested",
      listFromResponses({
        "src/removed/nested": [file("src/removed/nested/deep.ts")],
      })
    );

    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({
        src: [directory("src/kept"), file("src/index.ts")],
      })
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("src/kept")).toEqual(
      directory("src/kept")
    );
    expect(snapshot.entriesByPath.get("src/kept/still-here.ts")).toEqual(
      file("src/kept/still-here.ts")
    );
    expect(snapshot.entriesByPath.get("src/index.ts")).toEqual(
      file("src/index.ts")
    );
    expect(snapshot.entriesByPath.has("src/removed")).toBe(false);
    expect(snapshot.entriesByPath.has("src/removed/old.ts")).toBe(false);
    expect(snapshot.entriesByPath.has("src/removed/nested")).toBe(false);
    expect(snapshot.entriesByPath.has("src/removed/nested/deep.ts")).toBe(
      false
    );
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.get("src/kept")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.has("src/removed")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src/removed/nested")).toBe(
      false
    );
  });

  it("adds one entry with one notification and preserves unrelated entry identity", async () => {
    const readme = file("README.md");
    const src = directory("src");
    await loadRoot([readme, src]);
    let notifications = 0;
    const unsubscribe = subscribeFilesTreeSession(ROOT, () => {
      notifications += 1;
    });

    addFilesTreeEntry(ROOT, file("src/new.ts"));

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(notifications).toBe(1);
    expect(snapshot.entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
    expect(snapshot.entriesByPath.get("README.md")).toBe(readme);
    expect(snapshot.entriesByPath.get("src")).toBe(src);
    unsubscribe();
  });

  it("removes a directory subtree with one notification without removing same-prefix siblings", async () => {
    const readme = file("README.md");
    const samePrefixSibling = file("src-not-child.txt");
    const siblingDirectory = directory("sibling");
    await loadRoot([
      readme,
      directory("src"),
      file("src/index.ts"),
      directory("src/nested"),
      file("src/nested/deep.ts"),
      samePrefixSibling,
      siblingDirectory,
    ]);
    let notifications = 0;
    const unsubscribe = subscribeFilesTreeSession(ROOT, () => {
      notifications += 1;
    });

    removeFilesTreeEntry(ROOT, "src");

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(notifications).toBe(1);
    expect(snapshot.entriesByPath.has("src")).toBe(false);
    expect(snapshot.entriesByPath.has("src/index.ts")).toBe(false);
    expect(snapshot.entriesByPath.has("src/nested")).toBe(false);
    expect(snapshot.entriesByPath.has("src/nested/deep.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("src-not-child.txt")).toBe(
      samePrefixSibling
    );
    expect(snapshot.entriesByPath.get("README.md")).toBe(readme);
    expect(snapshot.entriesByPath.get("sibling")).toBe(siblingDirectory);
    unsubscribe();
  });

  it("never downgrades a known directory entry to a file on bare directory watch events", async () => {
    await loadRoot([directory("src")]);
    const list = listFromResponses({
      src: [directory("src/nested"), file("src/index.ts")],
      "src/nested": [file("src/nested/deep.ts")],
    });
    await loadFilesTreeDirectory(ROOT, "src", list);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/nested")).toEqual(
      directory("src/nested")
    );

    // macOS fs.watch 常把「目录内子文件写入」上报为目录自身的 rename 事件,
    // 且 debounce 批次里可能只有目录自己 —— 绝不能据此把目录覆盖成 file。
    const callsBeforeEvent = vi.mocked(list).mock.calls.length;
    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src/nested" }], root: ROOT },
      list,
      "Failed to load files"
    );
    await vi.waitFor(() =>
      expect(vi.mocked(list).mock.calls.length).toBeGreaterThan(
        callsBeforeEvent
      )
    );

    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/nested")).toEqual(
      directory("src/nested")
    );
  });

  it("re-lists an expanded directory when macOS reports only the directory itself", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/old.ts")] })
    );

    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src" }], root: ROOT },
      listFromResponses({
        "": [directory("src")],
        src: [file("src/new.ts")],
      }),
      "Failed to load files"
    );
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/new.ts")).toBe(
        true
      )
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/old.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
  });

  it("resolves unknown created paths by re-listing the loaded parent instead of guessing the kind", async () => {
    await loadRoot([directory("src")]);
    const initialList = listFromResponses({
      src: [file("src/index.ts")],
    });
    await loadFilesTreeDirectory(ROOT, "src", initialList);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/newdir")).toBe(
      false
    );

    // mkdir src/newdir 之后的事件批次里只有目录本身(无子路径),
    // kind 必须来自重新 listing 父目录,而不是猜成 file。
    const refreshedList = listFromResponses({
      src: [directory("src/newdir"), file("src/index.ts")],
    });
    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src/newdir" }], root: ROOT },
      refreshedList,
      "Failed to load files"
    );
    await settleStorePromises();

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("src/newdir")).toEqual(
      directory("src/newdir")
    );
    expect(snapshot.entriesByPath.get("src/index.ts")).toEqual(
      file("src/index.ts")
    );
  });

  it("queues a directory refresh when a watch event arrives during its load", async () => {
    await loadRoot([directory("src")]);
    const firstLoad = createDeferred<FileEntry[]>();
    let requestCount = 0;
    const list = vi.fn<FilesListApi>(() => {
      requestCount += 1;
      return requestCount === 1
        ? firstLoad.promise
        : Promise.resolve([file("src/new.ts")]);
    });

    const pendingLoad = loadFilesTreeDirectory(ROOT, "src", list);
    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src/new.ts" }], root: ROOT },
      list,
      "Failed to load files"
    );
    firstLoad.resolve([file("src/old.ts")]);
    await pendingLoad;
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/new.ts")).toBe(
        true
      )
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/old.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
  });

  it("queues a root refresh when a watch event arrives during its load", async () => {
    const firstLoad = createDeferred<FileEntry[]>();
    let requestCount = 0;
    const list = vi.fn<FilesListApi>(() => {
      requestCount += 1;
      return requestCount === 1
        ? firstLoad.promise
        : Promise.resolve([file("new.ts")]);
    });

    const pendingLoad = loadFilesTreeRoot(ROOT, list, "Failed to load files");
    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "changed", path: "." }], root: ROOT },
      list,
      "Failed to load files"
    );
    firstLoad.resolve([file("old.ts")]);
    await pendingLoad;
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("old.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("new.ts")).toEqual(file("new.ts"));
  });

  it("removes stale descendants when a watched directory becomes a file", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/old.ts")] })
    );

    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src" }], root: ROOT },
      listFromResponses({ "": [file("src")] }),
      "Failed to load files"
    );
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src")?.kind).toBe(
        "file"
      )
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/old.ts")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src")).toBe(false);
  });

  it("does not let an older directory load revive a path replaced by a file", async () => {
    await loadRoot([directory("src")]);
    const staleDirectoryLoad = createDeferred<FileEntry[]>();
    const directoryList = vi.fn<FilesListApi>(() => staleDirectoryLoad.promise);
    const pendingLoad = loadFilesTreeDirectory(ROOT, "src", directoryList);

    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src" }], root: ROOT },
      listFromResponses({ "": [file("src")] }),
      "Failed to load files"
    );
    staleDirectoryLoad.resolve([file("src/stale.ts")]);
    await pendingLoad;
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src")?.kind).toBe(
        "file"
      )
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/stale.ts")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src")).toBe(false);
  });

  it("does not let a descendant refresh revive a subtree removed by its ancestor", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [directory("src/nested")] })
    );
    await loadFilesTreeDirectory(
      ROOT,
      "src/nested",
      listFromResponses({
        "src/nested": [file("src/nested/old.ts")],
      })
    );
    const staleNestedLoad = createDeferred<FileEntry[]>();
    const list = vi.fn<FilesListApi>((_root, options) =>
      options?.path === "src/nested"
        ? staleNestedLoad.promise
        : Promise.resolve([])
    );

    applyFilesTreeWatchEvent(
      ROOT,
      {
        changes: [
          { kind: "changed", path: "src" },
          { kind: "changed", path: "src/nested" },
        ],
        root: ROOT,
      },
      list,
      "Failed to load files"
    );
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/nested")).toBe(
        false
      )
    );
    staleNestedLoad.resolve([file("src/nested/stale.ts")]);
    await settleStorePromises();

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/nested/stale.ts")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src/nested")).toBe(false);
  });

  it("does not refresh a descendant again after an ancestor removes it", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [directory("src/nested")] })
    );
    const activeNestedLoad = createDeferred<FileEntry[]>();
    const pendingNestedLoad = loadFilesTreeDirectory(
      ROOT,
      "src/nested",
      vi.fn<FilesListApi>(() => activeNestedLoad.promise)
    );
    const refreshedPaths: string[] = [];
    const watchList = vi.fn<FilesListApi>((requestOrRoot, options) => {
      const path =
        typeof requestOrRoot === "string"
          ? (options?.path ?? "")
          : requestOrRoot.path;
      refreshedPaths.push(path);
      return Promise.resolve(
        path === "src/nested" ? [file("src/nested/ghost.ts")] : []
      );
    });

    applyFilesTreeWatchEvent(
      ROOT,
      {
        changes: [
          { kind: "changed", path: "src" },
          { kind: "changed", path: "src/nested" },
        ],
        root: ROOT,
      },
      watchList,
      "Failed to load files"
    );
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/nested")).toBe(
        false
      )
    );
    activeNestedLoad.resolve([file("src/nested/stale.ts")]);
    await pendingNestedLoad;
    await settleStorePromises();

    expect(refreshedPaths).toEqual(["src"]);
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/nested/ghost.ts")).toBe(false);
    expect(snapshot.entriesByPath.has("src/nested/stale.ts")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src/nested")).toBe(false);
  });

  it("does not let an in-flight directory load revive a deleted path", async () => {
    await loadRoot([directory("src")]);
    const staleLoad = createDeferred<FileEntry[]>();
    const pendingLoad = loadFilesTreeDirectory(
      ROOT,
      "src",
      vi.fn<FilesListApi>(() => staleLoad.promise)
    );

    removeFilesTreeEntry(ROOT, "src");
    staleLoad.resolve([file("src/stale.ts")]);
    await pendingLoad;

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src")).toBe(false);
    expect(snapshot.entriesByPath.has("src/stale.ts")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src")).toBe(false);
  });

  it("does not let an in-flight directory load revive a moved source path", async () => {
    await loadRoot([directory("src")]);
    const staleLoad = createDeferred<FileEntry[]>();
    const pendingLoad = loadFilesTreeDirectory(
      ROOT,
      "src",
      vi.fn<FilesListApi>(() => staleLoad.promise)
    );

    moveFilesTreeEntry(ROOT, "src", "lib");
    staleLoad.resolve([file("src/stale.ts")]);
    await pendingLoad;

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("lib")).toEqual(directory("lib"));
    expect(snapshot.entriesByPath.has("src")).toBe(false);
    expect(snapshot.entriesByPath.has("src/stale.ts")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src")).toBe(false);
    expect(snapshot.directoryStatesByPath.get("lib")).toBe("unloaded");
  });

  it("does not let an in-flight parent load revive a deleted child", async () => {
    await loadRoot([directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/child.ts")] })
    );
    const staleLoad = createDeferred<FileEntry[]>();
    const pendingLoad = loadFilesTreeDirectory(
      ROOT,
      "src",
      vi.fn<FilesListApi>(() => staleLoad.promise)
    );

    removeFilesTreeEntry(ROOT, "src/child.ts");
    staleLoad.resolve([file("src/child.ts")]);
    await pendingLoad;

    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/child.ts")).toBe(
      false
    );
  });

  it("does not let an in-flight root load revive a moved top-level entry", async () => {
    await loadRoot([file("old.ts")]);
    const staleRootLoad = createDeferred<FileEntry[]>();
    const pendingLoad = reloadFilesTreeRoot(
      ROOT,
      vi.fn<FilesListApi>(() => staleRootLoad.promise),
      "Failed to load files"
    );

    moveFilesTreeEntry(ROOT, "old.ts", "new.ts");
    staleRootLoad.resolve([file("old.ts")]);
    await pendingLoad;

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.rootLoading).toBe(false);
    expect(snapshot.entriesByPath.has("old.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("new.ts")).toEqual(file("new.ts"));
  });

  it("does not let an in-flight destination load erase a moved entry", async () => {
    await loadRoot([directory("dest"), directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "dest",
      listFromResponses({ dest: [file("dest/existing.ts")] })
    );
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/a.ts")] })
    );
    const staleDestinationLoad = createDeferred<FileEntry[]>();
    const pendingLoad = loadFilesTreeDirectory(
      ROOT,
      "dest",
      vi.fn<FilesListApi>(() => staleDestinationLoad.promise)
    );

    moveFilesTreeEntry(ROOT, "src/a.ts", "dest/a.ts");
    staleDestinationLoad.resolve([file("dest/existing.ts")]);
    await pendingLoad;

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/a.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("dest/a.ts")).toEqual(file("dest/a.ts"));
  });

  it("settles a first destination load invalidated by a move", async () => {
    await loadRoot([directory("dest"), directory("src")]);
    await loadFilesTreeDirectory(
      ROOT,
      "src",
      listFromResponses({ src: [file("src/a.ts")] })
    );
    const staleDestinationLoad = createDeferred<FileEntry[]>();
    const pendingLoad = loadFilesTreeDirectory(
      ROOT,
      "dest",
      vi.fn<FilesListApi>(() => staleDestinationLoad.promise)
    );
    expect(getFilesTreeSnapshot(ROOT).directoryStatesByPath.get("dest")).toBe(
      "loading"
    );

    moveFilesTreeEntry(ROOT, "src/a.ts", "dest/a.ts");
    staleDestinationLoad.resolve([]);
    await pendingLoad;

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("dest/a.ts")).toEqual(file("dest/a.ts"));
    expect(snapshot.directoryStatesByPath.get("dest")).toBe("loaded");
  });

  it("removes deleted entries and ignores watch events under unloaded parents", async () => {
    await loadRoot([directory("src")]);
    const list = listFromResponses({
      src: [directory("src/nested"), file("src/index.ts")],
    });
    await loadFilesTreeDirectory(ROOT, "src", list);

    applyFilesTreeWatchEvent(
      ROOT,
      {
        changes: [
          { kind: "deleted", path: "src/index.ts" },
          // parent src/nested 未加载,不应产生任何 entry。
          { kind: "created", path: "src/nested/ghost.ts" },
        ],
        root: ROOT,
      },
      listFromResponses({ src: [directory("src/nested")] }),
      "Failed to load files"
    );
    await vi.waitFor(() =>
      expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/index.ts")).toBe(
        false
      )
    );

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/index.ts")).toBe(false);
    expect(snapshot.entriesByPath.has("src/nested/ghost.ts")).toBe(false);
  });

  it("moves a directory subtree with one notification and keeps unrelated entries intact", async () => {
    const readme = file("README.md");
    const siblingDirectory = directory("sibling");
    await loadRoot([readme, directory("src"), siblingDirectory]);
    const list = listFromResponses({
      src: [file("src/index.ts"), directory("src/nested")],
      "src/nested": [file("src/nested/deep.ts")],
    });
    await loadFilesTreeDirectory(ROOT, "src", list);
    await loadFilesTreeDirectory(ROOT, "src/nested", list);
    let notifications = 0;
    const unsubscribe = subscribeFilesTreeSession(ROOT, () => {
      notifications += 1;
    });

    moveFilesTreeEntry(ROOT, "src", "lib");

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(notifications).toBe(1);
    expect(snapshot.entriesByPath.has("src")).toBe(false);
    expect(snapshot.entriesByPath.has("src/index.ts")).toBe(false);
    expect(snapshot.entriesByPath.has("src/nested")).toBe(false);
    expect(snapshot.entriesByPath.has("src/nested/deep.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("lib")).toEqual(directory("lib"));
    expect(snapshot.entriesByPath.get("lib/index.ts")).toEqual(
      file("lib/index.ts")
    );
    expect(snapshot.entriesByPath.get("lib/nested")).toEqual(
      directory("lib/nested")
    );
    expect(snapshot.entriesByPath.get("lib/nested/deep.ts")).toEqual(
      file("lib/nested/deep.ts")
    );
    expect(snapshot.directoryStatesByPath.get("lib")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.get("lib/nested")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.has("src")).toBe(false);
    expect(snapshot.directoryStatesByPath.has("src/nested")).toBe(false);
    expect(snapshot.entriesByPath.get("README.md")).toBe(readme);
    expect(snapshot.entriesByPath.get("sibling")).toBe(siblingDirectory);
    unsubscribe();
  });
});
