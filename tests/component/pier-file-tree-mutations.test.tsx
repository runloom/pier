import {
  PierFileTree,
  type PierFileTreeItem,
  type PierFileTreeScrollController,
} from "@pier/ui/file-tree.tsx";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "../../packages/ui/node_modules/@pierre/trees";
import { pathSetMutation } from "../../packages/ui/src/file-tree-model.ts";

const batchSpy = vi.spyOn(FileTree.prototype, "batch");
const resetPathsSpy = vi.spyOn(FileTree.prototype, "resetPaths");
const setCompositionSpy = vi.spyOn(FileTree.prototype, "setComposition");

function file(path: string): PierFileTreeItem {
  return { kind: "file", path };
}

function directory(path: string): PierFileTreeItem {
  return { hasChildren: true, kind: "directory", path };
}

function tabFocusItems(): PierFileTreeItem[] {
  return [
    {
      hasChildren: true,
      kind: "directory",
      loadState: "unloaded",
      path: "src",
      trailingDecoration: "D",
    },
    { kind: "file", path: "src/index.ts", trailingDecoration: "M" },
    { kind: "file", path: "README.md", trailingDecoration: "A" },
  ];
}

function renderTree(items: readonly PierFileTreeItem[]) {
  return render(<PierFileTree items={items} label="Project files" />);
}

function getFileTreeHost(container: HTMLElement): HTMLElement {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );
  expect(host).toBeInstanceOf(HTMLElement);
  return host as HTMLElement;
}

function getFileTreeScrollElement(container: HTMLElement): HTMLElement {
  const scrollElement = getFileTreeHost(container).shadowRoot?.querySelector(
    '[data-file-tree-virtualized-scroll="true"]'
  );
  expect(scrollElement).toBeInstanceOf(HTMLElement);
  return scrollElement as HTMLElement;
}

function getTreeItem(container: HTMLElement, name: string): HTMLElement {
  const item = getFileTreeHost(container).shadowRoot?.querySelector(
    `[role="treeitem"][data-item-path="${name}"]`
  );
  expect(item).toBeInstanceOf(HTMLElement);
  return item as HTMLElement;
}

function mockFileTreeRows(
  container: HTMLElement,
  path: string,
  top: number,
  bottom: number
): void {
  const rows =
    getFileTreeHost(container).shadowRoot?.querySelectorAll(
      '[role="treeitem"][data-item-path]'
    ) ?? [];
  const matches: HTMLElement[] = [];
  for (const candidate of rows) {
    if (
      candidate instanceof HTMLElement &&
      candidate.dataset.itemPath === path
    ) {
      matches.push(candidate);
    }
  }
  expect(matches.length).toBeGreaterThan(0);
  for (const match of matches) {
    mockRect(match, top, bottom);
  }
}

function mockRect(element: HTMLElement, top: number, bottom: number): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({
      height: bottom - top,
      width: 240,
      x: 0,
      y: top,
    })
  );
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderMountedTree(items: readonly PierFileTreeItem[]) {
  const result = renderTree(items);
  await flushEffects();
  batchSpy.mockClear();
  resetPathsSpy.mockClear();
  setCompositionSpy.mockClear();
  return result;
}

beforeEach(() => {
  batchSpy.mockClear();
  resetPathsSpy.mockClear();
  setCompositionSpy.mockClear();
});

describe("PierFileTree path synchronization", () => {
  it("does not reset the model when rerendered with equivalent paths", async () => {
    const { rerender } = await renderMountedTree([
      file("README.md"),
      file("src/index.ts"),
    ]);

    rerender(
      <PierFileTree
        items={[file("README.md"), file("src/index.ts")]}
        label="Project files"
      />
    );
    await flushEffects();

    expect(batchSpy).not.toHaveBeenCalled();
    expect(resetPathsSpy).not.toHaveBeenCalled();
  });

  it("does not redraw the model for a tab focus rerender with unchanged file metadata", async () => {
    const { rerender } = await renderMountedTree(tabFocusItems());

    rerender(<PierFileTree items={tabFocusItems()} label="Project files" />);
    await flushEffects();

    expect(setCompositionSpy).not.toHaveBeenCalled();
    expect(batchSpy).not.toHaveBeenCalled();
    expect(resetPathsSpy).not.toHaveBeenCalled();
  });

  it("adds one path with a local batch operation instead of resetting", async () => {
    const { rerender } = await renderMountedTree([file("README.md")]);

    rerender(
      <PierFileTree
        items={[file("README.md"), file("src/index.ts")]}
        label="Project files"
      />
    );
    await flushEffects();

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith([
      { path: "src/index.ts", type: "add" },
    ]);
  });

  it("removes one path with a local batch operation instead of resetting", async () => {
    const { rerender } = await renderMountedTree([
      file("README.md"),
      file("src/index.ts"),
    ]);

    rerender(
      <PierFileTree items={[file("README.md")]} label="Project files" />
    );
    await flushEffects();

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith([
      { path: "src/index.ts", type: "remove" },
    ]);
  });

  it("moves one renamed path with a local batch operation instead of resetting", async () => {
    const { rerender } = await renderMountedTree([
      file("README.md"),
      file("src/old.ts"),
    ]);

    rerender(
      <PierFileTree
        items={[file("README.md"), file("src/new.ts")]}
        label="Project files"
      />
    );
    await flushEffects();

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith([
      { from: "src/old.ts", to: "src/new.ts", type: "move" },
    ]);
  });

  it("batches multiple path removals instead of resetting", async () => {
    const { rerender } = await renderMountedTree([
      directory("src"),
      file("src/one.ts"),
      file("src/two.ts"),
      file("README.md"),
    ]);

    rerender(
      <PierFileTree
        items={[directory("src"), file("README.md")]}
        label="Project files"
      />
    );
    await flushEffects();

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith([
      { path: "src/one.ts", type: "remove" },
      { path: "src/two.ts", type: "remove" },
    ]);
  });

  it("does not reopen a collapsed directory when a different directory loads", async () => {
    const initialItems = [
      directory("src"),
      file("src/one.ts"),
      file("src/two.ts"),
      directory("docs"),
    ];
    const { container, rerender } = await renderMountedTree(initialItems);
    const src = getTreeItem(container, "src/");
    const docs = getTreeItem(container, "docs/");
    expect(src).toHaveAttribute("aria-expanded", "true");

    src.click();
    docs.click();
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(docs).toHaveAttribute("aria-expanded", "true");

    batchSpy.mockClear();
    resetPathsSpy.mockClear();

    rerender(
      <PierFileTree
        items={[...initialItems, file("docs/guide.md"), file("docs/notes.md")]}
        label="Project files"
      />
    );
    await flushEffects();

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith([
      { path: "docs/guide.md", type: "add" },
      { path: "docs/notes.md", type: "add" },
    ]);
    expect(getTreeItem(container, "src/")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(getTreeItem(container, "docs/")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(getTreeItem(container, "docs/guide.md")).toBeTruthy();
    expect(getTreeItem(container, "docs/notes.md")).toBeTruthy();
  });

  it("batches multiple path additions for directory load without resetPaths", async () => {
    const { rerender } = await renderMountedTree([
      directory("docs"),
      file("README.md"),
    ]);

    rerender(
      <PierFileTree
        items={[
          directory("docs"),
          file("docs/a.ts"),
          file("docs/b.ts"),
          file("docs/c.ts"),
          file("README.md"),
        ]}
        label="Project files"
      />
    );
    await flushEffects();

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith([
      { path: "docs/a.ts", type: "add" },
      { path: "docs/b.ts", type: "add" },
      { path: "docs/c.ts", type: "add" },
    ]);
  });

  it("keeps scroll anchor stable across multi-add batch", async () => {
    const { container, rerender } = await renderMountedTree([
      file("src/above.ts"),
      file("src/anchor.ts"),
      file("src/below.ts"),
    ]);

    const frameCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }
    );

    const scrollElementBefore = getFileTreeScrollElement(container);
    mockRect(scrollElementBefore, 0, 120);
    mockFileTreeRows(container, "src/above.ts", -32, -8);
    mockFileTreeRows(container, "src/anchor.ts", 24, 48);
    scrollElementBefore.scrollTop = 200;

    rerender(
      <PierFileTree
        items={[
          file("src/inserted-a.ts"),
          file("src/inserted-b.ts"),
          file("src/above.ts"),
          file("src/anchor.ts"),
          file("src/below.ts"),
        ]}
        label="Project files"
      />
    );
    await flushEffects();

    // Path-sync schedules multi-frame restore after batch. Re-query DOM (batch may
    // replace nodes), lock the pre-restore scroll base, then shift the anchor.
    const scrollElement = getFileTreeScrollElement(container);
    scrollElement.scrollTop = 200;
    mockRect(scrollElement, 0, 120);
    mockFileTreeRows(container, "src/anchor.ts", 72, 96);

    const pendingFrames = [...frameCallbacks];
    frameCallbacks.length = 0;
    for (const callback of pendingFrames) {
      callback(performance.now());
    }

    expect(resetPathsSpy).not.toHaveBeenCalled();
    expect(batchSpy).toHaveBeenCalledWith([
      { path: "src/inserted-a.ts", type: "add" },
      { path: "src/inserted-b.ts", type: "add" },
    ]);
    // anchor moved down by 48px (24 → 72); scrollTop should increase by 48.
    expect(scrollElement.scrollTop).toBe(248);
  });
  it("restores by anchor row when inserted rows change the raw scroll offset", async () => {
    const scrollControllerRef = {
      current: null as PierFileTreeScrollController | null,
    };
    const { container } = render(
      <PierFileTree
        items={[
          file("src/above.ts"),
          file("src/anchor.ts"),
          file("src/below.ts"),
        ]}
        label="Project files"
        scrollControllerRef={scrollControllerRef}
      />
    );
    await flushEffects();

    const scrollElement = getFileTreeScrollElement(container);
    mockRect(scrollElement, 0, 120);
    mockFileTreeRows(container, "src/above.ts", -32, -8);
    mockFileTreeRows(container, "src/anchor.ts", 24, 48);
    scrollElement.scrollTop = 200;

    const snapshot = scrollControllerRef.current?.captureSnapshot();
    expect(snapshot).toMatchObject({
      fallbackScrollTop: 200,
      kind: "anchor",
      path: "src/anchor.ts",
      topOffset: 24,
    });

    mockRect(scrollElement, 0, 120);
    mockFileTreeRows(container, "src/anchor.ts", 72, 96);
    if (!snapshot) {
      throw new Error("expected an anchor scroll snapshot");
    }
    expect(scrollElement.scrollTop).toBe(200);
    scrollControllerRef.current?.restoreSnapshot(snapshot);

    expect(scrollElement.scrollTop).toBe(248);
  });

  it("ignores stale scheduled restore frames after a newer restore starts", async () => {
    const scrollControllerRef = {
      current: null as PierFileTreeScrollController | null,
    };
    const { container } = render(
      <PierFileTree
        items={[file("src/one.ts"), file("src/two.ts")]}
        label="Project files"
        scrollControllerRef={scrollControllerRef}
      />
    );
    await flushEffects();

    const scrollElement = getFileTreeScrollElement(container);
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }
    );

    scrollControllerRef.current?.restoreSnapshotSoon(
      { fallbackScrollTop: 100, kind: "position" },
      { frames: 1, lock: true }
    );
    scrollControllerRef.current?.restoreSnapshotSoon(
      { fallbackScrollTop: 300, kind: "position" },
      { frames: 1, lock: true }
    );
    expect(scrollElement.scrollTop).toBe(300);

    frameCallbacks[0]?.(performance.now());

    expect(scrollElement.scrollTop).toBe(300);
  });
});

describe("pathSetMutation", () => {
  it("returns multi-add ops for multiple new paths", () => {
    expect(pathSetMutation(["a.ts"], ["a.ts", "b.ts", "c.ts"])).toEqual([
      { path: "b.ts", type: "add" },
      { path: "c.ts", type: "add" },
    ]);
  });

  it("returns multi-remove ops for multiple deleted paths", () => {
    expect(pathSetMutation(["a.ts", "b.ts", "c.ts"], ["a.ts"])).toEqual([
      { path: "b.ts", type: "remove" },
      { path: "c.ts", type: "remove" },
    ]);
  });

  it("returns a move for a single same-parent rename", () => {
    expect(pathSetMutation(["src/old.ts"], ["src/new.ts"])).toEqual([
      { from: "src/old.ts", to: "src/new.ts", type: "move" },
    ]);
  });

  it("returns remove+add when parents differ", () => {
    expect(pathSetMutation(["src/old.ts"], ["lib/new.ts"])).toEqual([
      { path: "src/old.ts", type: "remove" },
      { path: "lib/new.ts", type: "add" },
    ]);
  });

  it("returns null when the path set is unchanged", () => {
    expect(pathSetMutation(["b.ts", "a.ts"], ["a.ts", "b.ts"])).toBeNull();
  });
});
