import type { PierCodeViewHandle } from "@pier/ui/diff-view-item-sync.ts";
import {
  acceptDiffViewItem,
  applyCodeViewItemsAnchored,
  deletedAnchorFallbackId,
  planDiffViewItemTransition,
  planPathAlignedIdRenames,
  resolveAnchoredItemId,
  syncCodeViewItems,
} from "@pier/ui/diff-view-item-sync.ts";
import type { PierDiffCodeViewItem } from "@pier/ui/diff-view-items.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

type Item = PierDiffCodeViewItem;

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
  readonly handle: PierCodeViewHandle;
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
  const instance = {
    getContainerElement: () => null,
    setItems,
  };
  const handle = {
    addItems,
    clearSelectedLines: vi.fn(),
    getEditor: vi.fn(),
    getInstance: () => instance as never,
    getItem: (id: string) => store.get(id),
    getSelectedLines: vi.fn(() => null),
    scrollTo: vi.fn(),
    setSelectedLines: vi.fn(),
    updateItem,
    updateItemId,
  } as unknown as PierCodeViewHandle;
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

describe("planDiffViewItemTransition", () => {
  it("classifies a half-stage slot removal as one reconcile", () => {
    const previous = [makeItem("s:a", 1, "a.ts"), makeItem("u:a", 1, "a.ts")];
    const next = [makeItem("s:a", 2, "a.ts")];
    expect(planDiffViewItemTransition(previous, next)).toEqual({
      kind: "reconcile",
    });
  });
});

describe("anchored item fallback", () => {
  it("keeps a surviving id", () => {
    const previous = [makeItem("a"), makeItem("b")];
    expect(resolveAnchoredItemId("a", previous, previous)).toBe("a");
  });

  it("follows a 1:1 path-aligned id migration", () => {
    expect(
      resolveAnchoredItemId(
        "unstaged:a",
        [makeItem("unstaged:a", 1, "a.ts")],
        [makeItem("staged:a", 2, "a.ts")]
      )
    ).toBe("staged:a");
  });

  it("uses successor, then predecessor, when the anchored item is deleted", () => {
    expect(
      deletedAnchorFallbackId("b", ["a", "b", "c"], new Set(["a", "c"]))
    ).toBe("c");
    expect(
      deletedAnchorFallbackId("c", ["a", "b", "c"], new Set(["a", "b"]))
    ).toBe("b");
    expect(deletedAnchorFallbackId("a", ["a"], new Set())).toBeNull();
  });

  it("resets deleted-file depth before one final layout transaction", () => {
    const previous = [makeItem("a"), makeItem("b"), makeItem("c")];
    const next = [previous[0]!, previous[2]!];
    const events: string[] = [];
    const { handle } = mockHandle({ items: previous });
    const instance = handle.getInstance();
    if (!instance) {
      throw new Error("expected a CodeView instance");
    }
    Object.assign(instance, {
      getRenderedItems: () => [
        {
          id: "b",
          instance: {
            getNumericScrollAnchor: () => ({
              lineNumber: 31,
              top: 620,
            }),
          },
        },
      ],
      getScrollTop: () => 600,
      getTopForItem: (id: string) => (id === "b" ? 0 : undefined),
      render: () => {
        events.push("render");
      },
    });
    handle.scrollTo = vi.fn(() => {
      events.push("scroll");
    });

    expect(
      applyCodeViewItemsAnchored(handle, next, previous, {
        flushLayout: true,
      })
    ).toMatchObject({ accepted: true, disposition: "preserved" });
    expect(handle.scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "c",
      offset: 0,
      type: "item",
    });
    expect(events).toEqual(["scroll", "render", "render"]);
  });

  it("preserves a visible line anchor across a path-aligned id migration", () => {
    const previous = [makeItem("unstaged:a", 1, "a.ts")];
    const next = [makeItem("staged:a", 2, "a.ts")];
    const events: string[] = [];
    const { handle } = mockHandle({ items: previous });
    const instance = handle.getInstance();
    if (!instance) {
      throw new Error("expected a CodeView instance");
    }
    const getNumericScrollAnchor = vi.fn(() => ({
      lineNumber: 31,
      side: "additions" as const,
      top: 656,
    }));
    Object.assign(instance, {
      itemMetricsCache: { diffHeaderHeight: 36 },
      getRenderedItems: () => [
        {
          id: "unstaged:a",
          instance: {
            getNumericScrollAnchor,
          },
        },
      ],
      getScrollTop: () => 600,
      getTopForItem: (id: string) => (id === "unstaged:a" ? 0 : undefined),
      render: () => {
        events.push("render");
      },
    });
    handle.scrollTo = vi.fn(() => {
      events.push("scroll");
    });

    applyCodeViewItemsAnchored(handle, next, previous, {
      flushLayout: true,
    });

    expect(getNumericScrollAnchor).toHaveBeenCalledWith(636);
    expect(handle.scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "staged:a",
      lineNumber: 31,
      offset: 20,
      side: "additions",
      type: "line",
    });
    expect(events).toEqual(["scroll", "render", "render"]);
  });

  it("uses a second synchronous layout pass after membership reconciliation", () => {
    const previous = [makeItem("a"), makeItem("b")];
    const next = [makeItem("a"), makeItem("c")];
    const { handle } = mockHandle({ items: previous });
    const instance = handle.getInstance();
    if (!instance) {
      throw new Error("expected a CodeView instance");
    }
    const render = vi.fn();
    Object.assign(instance, {
      getRenderedItems: () => [],
      getScrollTop: () => 0,
      getTopForItem: () => undefined,
      render,
    });

    applyCodeViewItemsAnchored(handle, next, previous, {
      flushLayout: true,
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(1, true);
    expect(render).toHaveBeenNthCalledWith(2, true);
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

  it("reconciles the authoritative list when Pierre rejects an incremental update", () => {
    const previous = [makeItem("a", 1)];
    const next = [makeItem("a", 2)];
    const { handle, setItems, updateItem } = mockHandle({
      items: previous,
    });
    updateItem.mockReturnValueOnce(false);

    expect(syncCodeViewItems(handle, next, previous)).toBe(true);
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(setItems).toHaveBeenCalledTimes(1);
    expect(setItems).toHaveBeenCalledWith(next);
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

  it("half-stage removal changes only the expected slot through one reconcile", () => {
    const previous = [makeItem("s:a", 1, "a.ts"), makeItem("u:a", 1, "a.ts")];
    const next = [makeItem("s:a", 2, "a.ts")];
    const { handle, setItems, updateItemId } = mockHandle({
      items: previous,
    });

    expect(syncCodeViewItems(handle, next, previous)).toBe(true);
    expect(updateItemId).not.toHaveBeenCalled();
    expect(setItems).toHaveBeenCalledTimes(1);
    expect(setItems).toHaveBeenCalledWith(next);
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
