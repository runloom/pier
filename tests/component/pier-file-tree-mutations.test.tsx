import {
  PierFileTree,
  type PierFileTreeItem,
  type PierFileTreeScrollController,
} from "@pier/ui/file-tree.tsx";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "../../packages/ui/node_modules/@pierre/trees";

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

  it("falls back to resetPaths for multiple path changes and preserves expanded directories", async () => {
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

    expect(batchSpy).not.toHaveBeenCalled();
    expect(resetPathsSpy).toHaveBeenCalledTimes(1);
    expect(resetPathsSpy).toHaveBeenCalledWith(["src/", "README.md"], {
      initialExpandedPaths: ["src"],
    });
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
