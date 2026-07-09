import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  addFilesTreeEntry,
  applyFilesTreeWatchEvent,
  clearFilesTreeStore,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  loadFilesTreeRoot,
  moveFilesTreeEntry,
  removeFilesTreeEntry,
  subscribeFilesTreeSession,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
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

    await loadFilesTreeDirectory(ROOT, "src", list);

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.directoryStatesByPath.get("src")).toBe("error");
    expect(snapshot.entriesByPath.get("README.md")).toBe(readme);
    expect(snapshot.entriesByPath.get("src")).toEqual(directory("src"));
    expect(snapshot.rootError).toBeNull();
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
    applyFilesTreeWatchEvent(
      ROOT,
      { changes: [{ kind: "created", path: "src/nested" }], root: ROOT },
      list,
      "Failed to load files"
    );
    await settleStorePromises();

    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/nested")).toEqual(
      directory("src/nested")
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
      list,
      "Failed to load files"
    );
    await settleStorePromises();

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
