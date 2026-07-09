import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { validateRelativePath } from "@plugins/builtin/files/renderer/file-tree-action-utils.ts";
import { createFilesTranslate } from "@plugins/builtin/files/renderer/files-i18n.ts";
import {
  allocateUniqueChildName,
  beginInlineCreate,
  cancelInlineCreate,
  commitCreatedPath,
  commitInlineCreate,
} from "@plugins/builtin/files/renderer/files-tree-create.ts";
import {
  clearFileTreeSidebarCache,
  peekPendingCreate,
  registerFilesTreeInstance,
  registerPendingCreate,
} from "@plugins/builtin/files/renderer/files-tree-registry.ts";
import {
  addFilesTreeEntry,
  clearFilesTreeStore,
  getFilesTreeSnapshot,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/repo";

function makeContext(overrides?: {
  existsPaths?: ReadonlySet<string>;
  writeText?: RendererPluginContext["files"]["writeText"];
  mkdir?: RendererPluginContext["files"]["mkdir"];
  openInstance?: RendererPluginContext["panels"]["openInstance"];
}) {
  const existsPaths = overrides?.existsPaths ?? new Set<string>();
  const openInstance =
    overrides?.openInstance ??
    vi.fn<RendererPluginContext["panels"]["openInstance"]>();

  const files = {
    exists: vi.fn<RendererPluginContext["files"]["exists"]>(
      async (request) => ({
        exists: existsPaths.has(request.path),
        path: request.path,
        root: request.root,
      })
    ),
    list: vi.fn<RendererPluginContext["files"]["list"]>(async () => []),
    mkdir:
      overrides?.mkdir ??
      vi.fn<RendererPluginContext["files"]["mkdir"]>(async (request) => ({
        created: true,
        path: request.path,
        root: request.root,
      })),
    writeText:
      overrides?.writeText ??
      vi.fn<RendererPluginContext["files"]["writeText"]>(async (request) => ({
        mtimeMs: 1,
        path: request.path,
        root: request.root,
        written: true as const,
      })),
  };
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => ({
      dismiss: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    })),
    success: vi.fn(),
    system: vi.fn(async () => ({ shown: true })),
  };
  const context = {
    files,
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn((_id: string, fallback?: string) => fallback ?? ""),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (
          _key: string,
          _values?: Record<string, number | string>,
          fallback?: string
        ) => fallback ?? _key
      ),
    },
    notifications,
    panels: {
      getActiveContext: vi.fn(() => ({
        contextId: "c",
        cwd: ROOT,
        projectRootPath: ROOT,
      })),
      openInstance,
    },
  } as unknown as RendererPluginContext;
  return { context, files, notifications, openInstance };
}

afterEach(() => {
  clearFilesTreeStore();
  clearFileTreeSidebarCache();
  vi.restoreAllMocks();
});

describe("allocateUniqueChildName", () => {
  it("returns the base name when free, then increments on conflict", async () => {
    const { files } = makeContext({
      existsPaths: new Set(["untitled.ts"]),
    });
    await expect(
      allocateUniqueChildName(ROOT, "", "untitled.ts", files.exists)
    ).resolves.toBe("untitled 2.ts");
  });
});

describe("validateRelativePath", () => {
  it("accepts nested relative paths and rejects traversal", () => {
    const t = createFilesTranslate(makeContext().context);
    expect(validateRelativePath("a/b/c.ts", t)).toBeNull();
    expect(validateRelativePath("../x", t)).not.toBeNull();
    expect(validateRelativePath("/abs", t)).not.toBeNull();
    expect(validateRelativePath("a//b", t)).not.toBeNull();
  });
});

describe("commitCreatedPath", () => {
  it("writes a file, patches the tree, opens pinned, and marks nested ancestors", async () => {
    const { context, files, openInstance } = makeContext();
    const ok = await commitCreatedPath({
      context,
      kind: "file",
      openAfter: true,
      path: "a/b/c.ts",
      root: ROOT,
      treeId: "group-1",
    });
    expect(ok).toBe(true);
    expect(files.writeText).toHaveBeenCalledWith({
      contents: "",
      path: "a/b/c.ts",
      root: ROOT,
    });
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("a")?.kind).toBe("directory");
    expect(snapshot.entriesByPath.get("a/b")?.kind).toBe("directory");
    expect(snapshot.entriesByPath.get("a/b/c.ts")).toEqual({
      kind: "file",
      path: "a/b/c.ts",
      root: ROOT,
    });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          pinned: true,
          source: { kind: "disk", path: "a/b/c.ts", root: ROOT },
        }),
        targetGroupId: "group-1",
      })
    );
  });

  it("marks a new folder as empty in directoryStates", async () => {
    const { context } = makeContext();
    await commitCreatedPath({
      context,
      kind: "folder",
      openAfter: false,
      path: "src/components",
      root: ROOT,
    });
    expect(
      getFilesTreeSnapshot(ROOT).directoryStatesByPath.get("src/components")
    ).toBe("empty");
  });
});

describe("inline create commit/cancel", () => {
  it("commits a pending placeholder to disk and opens the file", async () => {
    const { context, files, openInstance } = makeContext();
    addFilesTreeEntry(ROOT, {
      kind: "file",
      path: "src/untitled.ts",
      root: ROOT,
    });
    registerPendingCreate({
      kind: "file",
      openAfter: true,
      placeholderPath: "src/untitled.ts",
      root: ROOT,
      treeId: "g1",
    });
    const handled = await commitInlineCreate({
      context,
      from: "src/untitled.ts",
      root: ROOT,
      to: "src/new.ts",
    });
    expect(handled).toBe(true);
    expect(files.writeText).toHaveBeenCalledWith({
      contents: "",
      path: "src/new.ts",
      root: ROOT,
    });
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.has("src/untitled.ts")
    ).toBe(false);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/new.ts")).toEqual({
      kind: "file",
      path: "src/new.ts",
      root: ROOT,
    });
    expect(openInstance).toHaveBeenCalled();
    expect(peekPendingCreate(ROOT, "src/untitled.ts")).toBeNull();
  });

  it("removes the placeholder on cancel", () => {
    addFilesTreeEntry(ROOT, {
      kind: "file",
      path: "src/untitled.ts",
      root: ROOT,
    });
    registerPendingCreate({
      kind: "file",
      openAfter: true,
      placeholderPath: "src/untitled.ts",
      root: ROOT,
    });
    cancelInlineCreate(ROOT, "src/untitled.ts");
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.has("src/untitled.ts")
    ).toBe(false);
    expect(peekPendingCreate(ROOT, "src/untitled.ts")).toBeNull();
  });

  it("discards the placeholder and reloads when create commit conflicts", async () => {
    const removePaths = vi.fn();
    registerFilesTreeInstance("g1", {
      getApi: () =>
        ({
          focusSearchMatch: () => undefined,
          getSearchMatchCount: () => 0,
          removePaths,
          revealPath: () => undefined,
          setSearch: () => undefined,
          startRenaming: () => false,
        }) as never,
      openSearch: () => undefined,
      root: ROOT,
    });
    const { context, files, notifications } = makeContext({
      existsPaths: new Set(["src/taken.ts"]),
    });
    files.list.mockImplementation(async () => [
      { kind: "file" as const, path: "src/taken.ts", root: ROOT },
    ]);
    addFilesTreeEntry(ROOT, {
      kind: "file",
      path: "src/untitled.ts",
      root: ROOT,
    });
    // 冲突目标本就在 store:discard 不得误删它。
    addFilesTreeEntry(ROOT, {
      kind: "file",
      path: "src/taken.ts",
      root: ROOT,
    });
    registerPendingCreate({
      kind: "file",
      openAfter: true,
      placeholderPath: "src/untitled.ts",
      root: ROOT,
      treeId: "g1",
    });

    await commitInlineCreate({
      context,
      from: "src/untitled.ts",
      root: ROOT,
      to: "src/taken.ts",
    });

    expect(notifications.error).toHaveBeenCalled();
    expect(removePaths).toHaveBeenCalledWith(["src/untitled.ts"]);
    expect(files.list).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.has("src/untitled.ts")
    ).toBe(false);
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.get("src/taken.ts")
    ).toEqual({
      kind: "file",
      path: "src/taken.ts",
      root: ROOT,
    });
  });

  it("removes optimistic destination ghost when commit fails and to was not in store", async () => {
    const removePaths = vi.fn();
    registerFilesTreeInstance("g1", {
      getApi: () =>
        ({
          focusSearchMatch: () => undefined,
          getSearchMatchCount: () => 0,
          removePaths,
          revealPath: () => undefined,
          setSearch: () => undefined,
          startRenaming: () => false,
        }) as never,
      openSearch: () => undefined,
      root: ROOT,
    });
    const { context, files } = makeContext();
    vi.mocked(files.writeText).mockRejectedValueOnce(new Error("disk full"));
    addFilesTreeEntry(ROOT, {
      kind: "file",
      path: "src/untitled.ts",
      root: ROOT,
    });
    registerPendingCreate({
      kind: "file",
      openAfter: true,
      placeholderPath: "src/untitled.ts",
      root: ROOT,
      treeId: "g1",
    });

    await commitInlineCreate({
      context,
      from: "src/untitled.ts",
      root: ROOT,
      to: "src/new.ts",
    });

    expect(removePaths).toHaveBeenCalledWith(["src/untitled.ts", "src/new.ts"]);
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.has("src/untitled.ts")
    ).toBe(false);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/new.ts")).toBe(
      false
    );
  });
});

describe("beginInlineCreate", () => {
  it("falls back when the tree API cannot start renaming", async () => {
    const { context } = makeContext();
    registerFilesTreeInstance("g1", {
      getApi: () => null,
      openSearch: () => undefined,
      root: ROOT,
    });
    await expect(
      beginInlineCreate({
        context,
        kind: "file",
        parentDir: "src",
        root: ROOT,
        treeId: "g1",
      })
    ).resolves.toBe(false);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.size).toBe(0);
  });
});
