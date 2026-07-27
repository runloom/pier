import {
  acceptDiffViewItem,
  planPathAlignedIdRenames,
  syncCodeViewItems,
} from "@pier/ui/diff-view-item-sync.ts";
import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Item = CodeViewItem<undefined>;

function makeItem(id: string, version = 1, path = id): Item {
  return {
    id,
    type: "file",
    file: { name: path, contents: `// ${path}\n`, lang: "ts" },
    version,
  } as Item;
}

function mockHandle(options?: { readonly items?: Item[] }): {
  readonly addItems: ReturnType<typeof vi.fn>;
  readonly handle: CodeViewHandle<undefined>;
  readonly setItems: ReturnType<typeof vi.fn>;
  readonly updateItem: ReturnType<typeof vi.fn>;
  readonly updateItemId: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, Item>(
    (options?.items ?? []).map((item) => [item.id, item])
  );
  const setItems = vi.fn((items: Item[]) => {
    store.clear();
    for (const item of items) {
      store.set(item.id, item);
    }
  });
  const addItems = vi.fn((items: readonly Item[]) => {
    for (const item of items) {
      store.set(item.id, item);
    }
  });
  const updateItem = vi.fn((item: Item) => {
    store.set(item.id, item);
    return true;
  });
  const updateItemId = vi.fn((oldId: string, newId: string) => {
    const item = store.get(oldId);
    if (!item || store.has(newId)) {
      return false;
    }
    store.delete(oldId);
    store.set(newId, { ...item, id: newId });
    return true;
  });
  const handle = {
    addItems,
    clearSelectedLines: vi.fn(),
    getEditor: vi.fn(),
    getInstance: () =>
      ({
        getContainerElement: () => null,
        setItems,
      }) as never,
    getItem: (id: string) => store.get(id),
    getSelectedLines: vi.fn(() => null),
    scrollTo: vi.fn(),
    setSelectedLines: vi.fn(),
    updateItem,
    updateItemId,
  } as unknown as CodeViewHandle<undefined>;
  return { addItems, handle, setItems, updateItem, updateItemId };
}

describe("planPathAlignedIdRenames", () => {
  it("plans 1:1 path-aligned sectionKey renames", () => {
    const previous = [makeItem("unstaged:a", 1, "a.ts")];
    const next = [makeItem("staged:a", 2, "a.ts")];
    expect(planPathAlignedIdRenames(previous, next)).toEqual([
      ["unstaged:a", "staged:a"],
    ]);
  });

  it("rejects dual-slot same path (half-staged)", () => {
    const previous = [makeItem("u:a", 1, "a.ts"), makeItem("s:a", 1, "a.ts")];
    const next = [makeItem("s:a", 2, "a.ts")];
    expect(planPathAlignedIdRenames(previous, next)).toBeNull();
  });
});

describe("syncCodeViewItems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("append-only membership uses addItems and keeps the prefix", () => {
    const previous = [makeItem("a"), makeItem("b")];
    const next = [...previous, makeItem("c")];
    const { addItems, handle, setItems, updateItem } = mockHandle({
      items: previous,
    });

    expect(syncCodeViewItems(handle, next, previous)).toBe(true);
    expect(addItems).toHaveBeenCalledTimes(1);
    expect(addItems.mock.calls[0]?.[0]).toEqual([next[2]]);
    expect(setItems).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("same-order content change uses updateItem only", () => {
    const previous = [makeItem("a", 1)];
    const next = [makeItem("a", 2)];
    const { addItems, handle, setItems, updateItem } = mockHandle({
      items: previous,
    });

    expect(syncCodeViewItems(handle, next, previous)).toBe(true);
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem.mock.calls[0]?.[0]).toBe(next[0]);
    expect(addItems).not.toHaveBeenCalled();
    expect(setItems).not.toHaveBeenCalled();
  });

  it("path-aligned sectionKey rename uses updateItemId then updateItem", () => {
    const previous = [makeItem("old-id", 1, "file.ts")];
    const next = [makeItem("new-id", 2, "file.ts")];
    const { handle, setItems, updateItem, updateItemId } = mockHandle({
      items: previous,
    });

    expect(syncCodeViewItems(handle, next, previous)).toBe(true);
    expect(updateItemId).toHaveBeenCalledWith("old-id", "new-id");
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(setItems).not.toHaveBeenCalled();
  });

  it("reorder without path renames uses setItems reconcile", () => {
    const previous = [makeItem("a", 1, "a.ts"), makeItem("b", 1, "b.ts")];
    const next = [makeItem("b", 1, "b.ts"), makeItem("a", 1, "a.ts")];
    const { addItems, handle, setItems, updateItemId } = mockHandle({
      items: previous,
    });

    expect(syncCodeViewItems(handle, next, previous)).toBe(true);
    // same paths same ids → no rename plan with id changes; order differs → setItems
    expect(updateItemId).not.toHaveBeenCalled();
    expect(setItems).toHaveBeenCalledTimes(1);
    expect(setItems.mock.calls[0]?.[0]).toEqual(next);
    expect(addItems).not.toHaveBeenCalled();
  });

  it("acceptDiffViewItem treats same version as already applied", () => {
    const item = makeItem("a", 3);
    const { handle, updateItem } = mockHandle({
      items: [item],
    });
    const clone = { ...item };
    expect(acceptDiffViewItem(handle, clone)).toBe(true);
    expect(updateItem).not.toHaveBeenCalled();
  });
});
