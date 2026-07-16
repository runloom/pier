import type { FileTreeRefs } from "@pier/ui/file-tree-internal.ts";
import {
  type FileTreeRenameModel,
  FileTreeRenameSession,
} from "@pier/ui/file-tree-rename-session.ts";
import { describe, expect, it, vi } from "vitest";

interface RenameModelHarness {
  emitRemove: (path: string) => void;
  emitStoreChange: () => void;
  model: FileTreeRenameModel;
  setItemPresent: (present: boolean) => void;
  setRenameActive: (active: boolean) => void;
}

function createRenameModelHarness(): RenameModelHarness {
  let itemPresent = true;
  let renameActive = true;
  let removeListener: (event: { path: string }) => void = () => undefined;
  let storeListener: () => void = () => undefined;
  const renameViewSymbol = Symbol("FILE_TREE_RENAME_VIEW");
  const prototype = {
    [renameViewSymbol]: () => ({
      getPath: () => "draft.txt",
      isActive: () => renameActive,
    }),
  };
  const model = Object.assign(Object.create(prototype) as object, {
    getItem: () => (itemPresent ? {} : undefined),
    onMutation: (
      _type: "remove",
      listener: (event: { path: string }) => void
    ) => {
      removeListener = listener;
      return () => undefined;
    },
    subscribe: (listener: () => void) => {
      storeListener = listener;
      return () => undefined;
    },
  }) as unknown as FileTreeRenameModel;

  return {
    emitRemove: (path) => removeListener({ path }),
    emitStoreChange: () => storeListener(),
    model,
    setItemPresent: (present) => {
      itemPresent = present;
    },
    setRenameActive: (active) => {
      renameActive = active;
    },
  };
}

function createRefs(): FileTreeRefs {
  return {
    decorationsByPath: new Map(),
    directoryLoadStatesByPath: new Map(),
    directoryPaths: new Map(),
    itemsByPath: new Map(),
    loadableDirectoryPaths: new Map(),
    onLoadDirectory: undefined,
    onModelPathsRemoved: vi.fn(),
    onMovePaths: undefined,
    onOpenItemContextMenu: undefined,
    onOpenPath: undefined,
    onRenamePath: vi.fn(),
    onSelectPaths: undefined,
  };
}

function beginSession(
  session: FileTreeRenameSession,
  harness: RenameModelHarness,
  readRefs: () => FileTreeRefs
) {
  session.begin({
    callerPath: "draft.txt",
    isFolder: false,
    model: harness.model,
    officialPath: "draft.txt",
    readRefs,
  });
}

describe("FileTreeRenameSession", () => {
  it("lets the later remove mutation complete a canceled placeholder", async () => {
    const session = new FileTreeRenameSession();
    const harness = createRenameModelHarness();
    const refs = createRefs();
    beginSession(session, harness, () => refs);

    harness.setRenameActive(false);
    harness.setItemPresent(false);
    harness.emitStoreChange();
    expect(refs.onModelPathsRemoved).not.toHaveBeenCalled();
    harness.emitRemove("draft.txt");

    expect(refs.onModelPathsRemoved).toHaveBeenCalledOnce();
    expect(refs.onModelPathsRemoved).toHaveBeenCalledWith(["draft.txt"]);
    expect(refs.onRenamePath).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(refs.onModelPathsRemoved).toHaveBeenCalledOnce();
  });

  it("commits an unchanged default name exactly once", () => {
    const session = new FileTreeRenameSession();
    const harness = createRenameModelHarness();
    const refs = createRefs();
    beginSession(session, harness, () => refs);

    harness.setRenameActive(false);
    harness.emitStoreChange();

    expect(refs.onRenamePath).toHaveBeenCalledOnce();
    expect(refs.onRenamePath).toHaveBeenCalledWith({
      from: "draft.txt",
      isFolder: false,
      to: "draft.txt",
    });
    expect(refs.onModelPathsRemoved).not.toHaveBeenCalled();
  });

  it("does not deliver queued notifications after dispose", async () => {
    const session = new FileTreeRenameSession();
    const harness = createRenameModelHarness();
    const refs = createRefs();
    beginSession(session, harness, () => refs);

    harness.setRenameActive(false);
    harness.setItemPresent(false);
    harness.emitStoreChange();
    session.dispose();
    harness.emitRemove("draft.txt");
    await Promise.resolve();

    expect(refs.onRenamePath).not.toHaveBeenCalled();
    expect(refs.onModelPathsRemoved).not.toHaveBeenCalled();
  });

  it("reads the latest committed callback snapshot", () => {
    const session = new FileTreeRenameSession();
    const harness = createRenameModelHarness();
    const firstRefs = createRefs();
    const latestRefs = createRefs();
    let refs = firstRefs;
    beginSession(session, harness, () => refs);
    refs = latestRefs;

    harness.setRenameActive(false);
    harness.emitStoreChange();

    expect(firstRefs.onRenamePath).not.toHaveBeenCalled();
    expect(latestRefs.onRenamePath).toHaveBeenCalledOnce();
  });
});
