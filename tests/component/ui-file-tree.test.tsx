import {
  PierFileTree,
  type PierFileTreeApi,
  type PierFileTreeGitStatus,
  type PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import { collectPreservedExpandedDirectoryPaths } from "@pier/ui/file-tree-model.ts";
import { TREE_SCROLLBAR_CSS } from "@pier/ui/file-tree-style.ts";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

const SRC_NAME_PATTERN = /src/;
const APP_TSX_NAME_PATTERN = /app\.tsx/;
const README_NAME_PATTERN = /README\.md/;
const DIRECTORY_LOADING_OR_ERROR_PATTERN = /loading|error/i;
const DIRECTORY_ERROR_PATTERN = /error/i;

type PierDirectoryLoadState =
  | "unloaded"
  | "loading"
  | "loaded"
  | "dirty"
  | "empty"
  | "error";

type LazyPierFileTreeItem = PierFileTreeItem & {
  hasChildren?: boolean | "unknown";
  loadState?: PierDirectoryLoadState;
};

type GitStatusPierFileTreeItem = PierFileTreeItem & {
  gitStatus: PierFileTreeGitStatus;
};

type LazyPierFileTreeProps = Omit<
  ComponentProps<typeof PierFileTree>,
  "items"
> & {
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>;
  items: readonly LazyPierFileTreeItem[];
  onLoadDirectory?: (path: string) => Promise<void> | void;
};

const LazyPierFileTree = PierFileTree as ComponentType<LazyPierFileTreeProps>;

function getFileTreeHost(container: HTMLElement): HTMLElement {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );

  expect(host).toBeInstanceOf(HTMLElement);
  return host as HTMLElement;
}

function getFileTree(container: HTMLElement): HTMLElement {
  const tree =
    getFileTreeHost(container).shadowRoot?.querySelector('[role="tree"]');

  expect(tree).toBeInstanceOf(HTMLElement);
  return tree as HTMLElement;
}

const items: PierFileTreeItem[] = [
  { kind: "directory", path: "src" },
  { kind: "file", path: "src/app.tsx", trailingDecoration: "M" },
  { kind: "file", path: "README.md", trailingDecoration: "A" },
];

describe("PierFileTree", () => {
  it("does not preserve expansion onto an error-state compact-chain leaf", () => {
    expect(
      collectPreservedExpandedDirectoryPaths(
        [
          { kind: "directory", path: "src", hasChildren: true },
          {
            kind: "directory",
            path: "src/generated",
            hasChildren: true,
          },
        ],
        new Map([["src/", true]]),
        new Map([
          ["src", "loaded"],
          ["src/generated", "error"],
        ])
      )
    ).toEqual(["src"]);
  });

  it("renders the official file-tree host as the root element", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const host = getFileTreeHost(container);
    expect(host?.tagName.toLowerCase()).toBe("file-tree-container");
    // bridge wrapper 承接布局/滚动快照职责,host 是其唯一子元素。
    const bridge = container.firstElementChild;
    expect(bridge?.getAttribute("data-slot")).toBe("pier-file-tree-bridge");
    expect(bridge?.firstElementChild).toBe(host);
  });

  it("keeps scrolling on the official shadow scroller instead of the wrapper host", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const host = getFileTreeHost(container);
    expect(host).toHaveClass("min-h-0", "w-full", "h-full");
    expect(host).not.toHaveClass("overflow-auto");
    expect(
      host.shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      )
    ).toBeInstanceOf(HTMLElement);
  });

  it("maps Pier scrollbar tokens onto @pierre/trees official scrollbar variables", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const host = getFileTreeHost(container);
    expect(
      host.style.getPropertyValue("--trees-scrollbar-thumb-override").trim()
    ).toBe("var(--shell-scrollbar-thumb)");
    expect(
      host.style.getPropertyValue("--trees-scrollbar-gutter-override").trim()
    ).toBe("var(--shell-scrollbar-width-legacy)");
  });

  it("uses Pier scrollbar interaction tokens inside the shadow scroller", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const shadowCss =
      getFileTreeHost(container).shadowRoot?.querySelector(
        "style[data-file-tree-unsafe-css]"
      )?.textContent ?? "";
    expect(shadowCss).toContain("--trees-scrollbar-thumb-current: transparent");
    expect(shadowCss).toContain('[data-scrollbar-scrolling="true"]');
    expect(shadowCss).toContain("var(--shell-scrollbar-thumb-active)");
    expect(shadowCss).toContain("var(--shell-scrollbar-radius)");
    expect(shadowCss).toContain("var(--shell-scrollbar-track)");
    expect(shadowCss).toContain(
      "scrollbar-width: var(--shell-scrollbar-width)"
    );
    expect(shadowCss).toContain('[data-file-tree-scrollbar-measure="true"]');
    expect(shadowCss).not.toContain(
      '[data-file-tree-virtualized-scroll="true"]:hover {'
    );
  });

  it("reveals the shadow scrollbar only while scrolling is active", async () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );
    const scroller = getFileTreeHost(container).shadowRoot?.querySelector(
      '[data-file-tree-virtualized-scroll="true"]'
    );
    expect(scroller).toBeInstanceOf(HTMLElement);

    await waitFor(() => {
      fireEvent.scroll(scroller as HTMLElement);
      expect(scroller).toHaveAttribute("data-scrollbar-scrolling", "true");
    });
  });

  it("renders directory and file rows from path-first items", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const tree = getFileTree(container);
    expect(within(tree).getByRole("treeitem", { name: "src" })).toBeVisible();
    expect(
      within(tree).getByRole("treeitem", { name: APP_TSX_NAME_PATTERN })
    ).toBeVisible();
    expect(
      within(tree).getByRole("treeitem", { name: README_NAME_PATTERN })
    ).toBeVisible();
  });

  it("uses trailing ellipsis for ordinary item names", () => {
    const { container } = render(
      <PierFileTree
        items={[
          {
            kind: "file",
            path: "a-very-long-file-name-that-needs-truncation.css",
          },
        ]}
        label="Project files"
      />
    );

    const content = getFileTree(container).querySelector(
      '[data-item-section="content"]'
    );
    expect(
      content?.querySelector('[data-truncate-container="truncate"]')
    ).toBeInstanceOf(HTMLElement);
    expect(
      content?.querySelector('[data-truncate-group-container="middle"]')
    ).toBeNull();
  });

  it("lets item names consume space left by an empty decoration lane", () => {
    expect(TREE_SCROLLBAR_CSS).toContain(
      '[data-item-section="content"] {\n  flex: 1 1 auto;'
    );
    expect(TREE_SCROLLBAR_CSS).toContain(
      '[data-item-section="decoration"]:empty {\n  flex: 0 0 0;'
    );
    expect(TREE_SCROLLBAR_CSS).toContain(
      '[data-item-section="git"]:empty,\n[data-item-section="action"]:empty {\n  display: none;'
    );
  });

  it("restores the full tree after clearing or cancelling a search filter", async () => {
    const treeApi = { current: null as PierFileTreeApi | null };
    const { container } = render(
      <PierFileTree items={items} label="Project files" treeApiRef={treeApi} />
    );
    const tree = getFileTree(container);
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(3);

    act(() => {
      treeApi.current?.setSearch("readme");
    });
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getAllByRole("treeitem")
      ).toHaveLength(1);
    });
    expect(treeApi.current?.getSearchMatchCount()).toBe(1);

    // 清空输入(等价于取消搜索):必须还原完整投影。
    act(() => {
      treeApi.current?.setSearch(null);
    });
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getAllByRole("treeitem")
      ).toHaveLength(3);
    });

    // 再来一轮,用空字符串路径(输入框清空时上层可能传 "" 而不是 null)。
    act(() => {
      treeApi.current?.setSearch("app");
    });
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getAllByRole("treeitem")
      ).not.toHaveLength(3);
    });
    act(() => {
      treeApi.current?.setSearch("");
    });
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getAllByRole("treeitem")
      ).toHaveLength(3);
    });
  });

  it("matches path substrings and keeps a non-empty zero-result search empty", async () => {
    const treeApi = { current: null as PierFileTreeApi | null };
    const searchItems: PierFileTreeItem[] = [
      { kind: "file", path: "app.tsx" },
      { kind: "file", path: "reset.css" },
      { kind: "file", path: "theme.CSS" },
    ];
    const onSearchMatchStateChange = vi.fn();
    const onOpenPath = vi.fn<(path: string) => void>();
    const onSelectPaths = vi.fn<(paths: string[]) => void>();
    const { container } = render(
      <PierFileTree
        items={searchItems}
        label="Project files"
        onOpenPath={onOpenPath}
        onSearchMatchStateChange={onSearchMatchStateChange}
        onSelectPaths={onSelectPaths}
        treeApiRef={treeApi}
      />
    );

    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", { name: "app.tsx" })
    );
    expect(onSelectPaths).toHaveBeenLastCalledWith(["app.tsx"]);

    act(() => {
      treeApi.current?.setSearch(".css");
    });
    await waitFor(() => {
      const tree = getFileTree(container);
      expect(
        within(tree).getByRole("treeitem", { name: "reset.css" })
      ).toBeVisible();
      expect(
        within(tree).getByRole("treeitem", { name: "theme.CSS" })
      ).toBeVisible();
      expect(
        within(tree).queryByRole("treeitem", { name: "app.tsx" })
      ).toBeNull();
    });
    expect(treeApi.current?.getSearchMatchCount()).toBe(2);
    expect(onSearchMatchStateChange).toHaveBeenLastCalledWith({
      focusedMatchOpenable: true,
      matchCount: 2,
    });

    act(() => {
      expect(treeApi.current?.activateFocusedSearchMatch()).toBe(true);
    });
    expect(onOpenPath).toHaveBeenLastCalledWith("reset.css");
    expect(onSelectPaths).toHaveBeenLastCalledWith(["reset.css"]);
    act(() => {
      treeApi.current?.focusSearchMatch("next");
      expect(treeApi.current?.activateFocusedSearchMatch()).toBe(true);
    });
    expect(onOpenPath).toHaveBeenLastCalledWith("theme.CSS");

    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", {
        name: "reset.css",
      })
    );
    await waitFor(() => {
      const tree = getFileTree(container);
      expect(
        within(tree).queryByRole("treeitem", { name: "app.tsx" })
      ).toBeNull();
      expect(within(tree).getAllByRole("treeitem")).toHaveLength(2);
    });
    expect(treeApi.current?.getSearchMatchCount()).toBe(2);
    expect(onOpenPath).toHaveBeenLastCalledWith("reset.css");

    act(() => {
      treeApi.current?.setSearch(".missing");
    });
    await waitFor(() => {
      expect(
        within(getFileTree(container)).queryAllByRole("treeitem")
      ).toHaveLength(0);
    });
    expect(treeApi.current?.getSearchMatchCount()).toBe(0);
    expect(onSearchMatchStateChange).toHaveBeenLastCalledWith({
      focusedMatchOpenable: false,
      matchCount: 0,
    });

    act(() => {
      treeApi.current?.setSearch(null);
    });
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getAllByRole("treeitem")
      ).toHaveLength(3);
    });
  });

  it("reports directory-only matches as non-openable", async () => {
    const treeApi = { current: null as PierFileTreeApi | null };
    const onSearchMatchStateChange = vi.fn();
    render(
      <PierFileTree
        items={[{ kind: "directory", path: "empty-folder" }]}
        label="Project files"
        onSearchMatchStateChange={onSearchMatchStateChange}
        treeApiRef={treeApi}
      />
    );

    act(() => {
      treeApi.current?.setSearch("empty-folder");
    });
    await waitFor(() => {
      expect(onSearchMatchStateChange).toHaveBeenLastCalledWith({
        focusedMatchOpenable: false,
        matchCount: 1,
      });
    });
    expect(treeApi.current?.activateFocusedSearchMatch()).toBe(false);
  });

  it("restores the full tree after items grew (resetPaths) during an active search", async () => {
    // 真实场景:搜索展开匹配祖先 → 懒加载完成 → items 批量增长 →
    // PierFileTree 路径同步走 resetPaths。清空搜索必须还原完整投影。
    const treeApi = { current: null as PierFileTreeApi | null };
    const initialItems: PierFileTreeItem[] = [
      { hasChildren: "unknown", kind: "directory", path: "src" },
      { kind: "file", path: "README.md" },
    ];
    const grownItems: PierFileTreeItem[] = [
      { hasChildren: "unknown", kind: "directory", path: "src" },
      { kind: "file", path: "src/app.tsx" },
      { kind: "file", path: "src/main.ts" },
      { kind: "file", path: "src/util.ts" },
      { kind: "file", path: "README.md" },
    ];
    const { container, rerender } = render(
      <PierFileTree
        items={initialItems}
        label="Project files"
        treeApiRef={treeApi}
      />
    );

    // 用户已经展开 src；后续搜索与路径重建必须恢复这份显式状态。
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", {
        name: SRC_NAME_PATTERN,
      })
    );

    act(() => {
      treeApi.current?.setSearch("app");
    });
    // 搜索激活期间 items 批量增长(>1 路径变化 → resetPaths)。
    rerender(
      <PierFileTree
        items={grownItems}
        label="Project files"
        treeApiRef={treeApi}
      />
    );

    act(() => {
      treeApi.current?.setSearch(null);
    });
    // 还原是异步的(虚拟化重绘一拍);断言用 data-item-path,不依赖行内文本结构。
    await waitFor(() => {
      const paths = [
        ...(getFileTreeHost(container).shadowRoot?.querySelectorAll(
          '[role="treeitem"][data-item-path]'
        ) ?? []),
      ].map((row) => (row as HTMLElement).dataset.itemPath);
      expect(paths).toContain("README.md");
      expect(paths).toContain("src/");
      expect(paths).toContain("src/app.tsx");
      // 完整投影:不残留 hide-non-matches 过滤。
      expect(paths.length).toBeGreaterThanOrEqual(5);
    });
    expect(treeApi.current?.getSearchMatchCount()).toBe(0);
  });

  it("opens a file path when its row is clicked or activated with Enter", () => {
    const onOpenPath = vi.fn<(path: string) => void>();
    const { container } = render(
      <PierFileTree
        items={items}
        label="Project files"
        onOpenPath={onOpenPath}
      />
    );

    const tree = within(getFileTree(container));
    const appRow = tree.getByRole("treeitem", {
      name: APP_TSX_NAME_PATTERN,
    });
    const readmeRow = tree.getByRole("treeitem", {
      name: README_NAME_PATTERN,
    });

    fireEvent.click(appRow);
    expect(readmeRow).toBeInstanceOf(HTMLButtonElement);
    readmeRow.focus();
    expect(fireEvent.keyDown(readmeRow, { key: "Enter" })).toBe(true);
    readmeRow.click();

    expect(onOpenPath).toHaveBeenNthCalledWith(1, "src/app.tsx");
    expect(onOpenPath).toHaveBeenNthCalledWith(2, "README.md");
  });

  it("selects a row by reporting its path", () => {
    const onSelectPaths = vi.fn<(paths: string[]) => void>();
    const { container } = render(
      <PierFileTree
        items={items}
        label="Project files"
        onSelectPaths={onSelectPaths}
      />
    );

    const tree = within(getFileTree(container));

    fireEvent.click(tree.getByRole("treeitem", { name: APP_TSX_NAME_PATTERN }));

    expect(onSelectPaths).toHaveBeenCalledWith(["src/app.tsx"]);
  });

  it("reports directory selections using the caller's exact path", () => {
    const onSelectPaths = vi.fn<(paths: string[]) => void>();
    const { container } = render(
      <PierFileTree
        items={[{ kind: "directory", path: "src" }]}
        label="Project files"
        onSelectPaths={onSelectPaths}
      />
    );

    const tree = within(getFileTree(container));

    fireEvent.click(tree.getByRole("treeitem", { name: "src" }));

    expect(onSelectPaths).toHaveBeenCalledWith(["src"]);
  });

  it("renders directory trailing decorations supplied by items", () => {
    const { container } = render(
      <PierFileTree
        items={[{ kind: "directory", path: "src", trailingDecoration: "D" }]}
        label="Project files"
      />
    );

    const tree = within(getFileTree(container));
    const srcRow = tree.getByRole("treeitem", { name: SRC_NAME_PATTERN });

    expect(within(srcRow).getByText("D")).toBeVisible();
  });

  it("renders trailing decorations supplied by items", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const tree = within(getFileTree(container));
    const appRow = tree.getByRole("treeitem", {
      name: APP_TSX_NAME_PATTERN,
    });
    const readmeRow = tree.getByRole("treeitem", {
      name: README_NAME_PATTERN,
    });

    expect(within(appRow).getByText("M")).toBeVisible();
    expect(within(readmeRow).getByText("A")).toBeVisible();
  });

  it("passes item git status into @pierre/trees built-in git lane", () => {
    const gitItems: GitStatusPierFileTreeItem[] = [
      { gitStatus: "modified", kind: "file", path: "src/app.tsx" },
      { gitStatus: "added", kind: "file", path: "README.md" },
    ];
    const { container } = render(
      <PierFileTree items={gitItems} label="Project files" />
    );

    const tree = within(getFileTree(container));
    const appRow = tree.getByRole("treeitem", {
      name: APP_TSX_NAME_PATTERN,
    });
    const readmeRow = tree.getByRole("treeitem", {
      name: README_NAME_PATTERN,
    });

    expect(appRow).toHaveAttribute("data-item-git-status", "modified");
    const appGitLane = appRow.querySelector('[data-item-section="git"]');
    expect(appGitLane).toBeInstanceOf(HTMLElement);
    expect(within(appGitLane as HTMLElement).getByText("M")).toBeVisible();

    expect(readmeRow).toHaveAttribute("data-item-git-status", "added");
    const readmeGitLane = readmeRow.querySelector('[data-item-section="git"]');
    expect(readmeGitLane).toBeInstanceOf(HTMLElement);
    expect(within(readmeGitLane as HTMLElement).getByText("A")).toBeVisible();
  });

  it("updates item git status in @pierre/trees built-in git lane after rerender", async () => {
    const { container, rerender } = render(
      <PierFileTree
        items={[{ gitStatus: "modified", kind: "file", path: "src/app.tsx" }]}
        label="Project files"
      />
    );

    const tree = within(getFileTree(container));
    const appRow = tree.getByRole("treeitem", {
      name: APP_TSX_NAME_PATTERN,
    });
    expect(appRow).toHaveAttribute("data-item-git-status", "modified");
    const appGitLane = appRow.querySelector('[data-item-section="git"]');
    expect(appGitLane).toBeInstanceOf(HTMLElement);
    expect(within(appGitLane as HTMLElement).getByText("M")).toBeVisible();

    rerender(
      <PierFileTree
        items={[{ gitStatus: "deleted", kind: "file", path: "src/app.tsx" }]}
        label="Project files"
      />
    );

    await waitFor(() => {
      const updatedAppRow = within(getFileTree(container)).getByRole(
        "treeitem",
        {
          name: APP_TSX_NAME_PATTERN,
        }
      );
      expect(updatedAppRow).toHaveAttribute("data-item-git-status", "deleted");
      const updatedGitLane = updatedAppRow.querySelector(
        '[data-item-section="git"]'
      );
      expect(updatedGitLane).toBeInstanceOf(HTMLElement);
      expect(
        within(updatedGitLane as HTMLElement).getByText("D")
      ).toBeVisible();
      expect(
        within(updatedGitLane as HTMLElement).queryByText("M")
      ).not.toBeInTheDocument();
    });
  });

  it.each([
    ["known child presence", true],
    ["unknown child presence", "unknown"],
  ] as const)("renders an unloaded directory with %s as an expandable row without fake children", (_caseName, hasChildren) => {
    const { container } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
      />
    );

    const tree = within(getFileTree(container));
    const srcRow = tree.getByRole("treeitem", { name: SRC_NAME_PATTERN });

    expect(srcRow).toHaveAttribute("data-item-type", "folder");
    expect(srcRow).toHaveAttribute("aria-expanded", "false");
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);

    fireEvent.click(srcRow);
    expect(srcRow).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(srcRow);
    expect(srcRow).toHaveAttribute("aria-expanded", "false");
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("loads an unloaded directory by caller path when pointer activation expands it", () => {
    const onLoadDirectory = vi.fn<(path: string) => void>();
    const { container } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: true,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
        onLoadDirectory={onLoadDirectory}
      />
    );

    const tree = within(getFileTree(container));
    fireEvent.click(tree.getByRole("treeitem", { name: SRC_NAME_PATTERN }));

    expect(onLoadDirectory).toHaveBeenCalledTimes(1);
    expect(onLoadDirectory).toHaveBeenCalledWith("src");
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("routes item context menus through the tree model with the caller path", async () => {
    const onOpenItemContextMenu = vi.fn();
    const { container } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: true,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
        onOpenItemContextMenu={onOpenItemContextMenu}
      />
    );

    const tree = within(getFileTree(container));
    const srcRow = tree.getByRole("treeitem", { name: SRC_NAME_PATTERN });

    expect(srcRow).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.contextMenu(srcRow, { clientX: 24, clientY: 48 });

    await waitFor(() => {
      expect(onOpenItemContextMenu).toHaveBeenCalledWith(
        { kind: "directory", path: "src" },
        { x: 24, y: 48 }
      );
    });

    onOpenItemContextMenu.mockClear();
    srcRow.focus();
    fireEvent.keyDown(srcRow, { key: "F10", shiftKey: true });

    await waitFor(() => {
      expect(onOpenItemContextMenu).toHaveBeenCalledTimes(1);
    });
  });

  it("synchronizes context-menu enablement after mount", async () => {
    const onOpenItemContextMenu = vi.fn();
    const treeItems: LazyPierFileTreeItem[] = [
      {
        kind: "directory",
        path: "src",
        hasChildren: true,
        loadState: "unloaded",
      },
    ];
    const { container, rerender } = render(
      <LazyPierFileTree items={treeItems} label="Project files" />
    );
    let srcRow = within(getFileTree(container)).getByRole("treeitem", {
      name: SRC_NAME_PATTERN,
    });
    expect(srcRow).not.toHaveAttribute("aria-haspopup", "menu");

    rerender(
      <LazyPierFileTree
        items={treeItems}
        label="Project files"
        onOpenItemContextMenu={onOpenItemContextMenu}
      />
    );
    await waitFor(() => {
      srcRow = within(getFileTree(container)).getByRole("treeitem", {
        name: SRC_NAME_PATTERN,
      });
      expect(srcRow).toHaveAttribute("aria-haspopup", "menu");
    });
    fireEvent.contextMenu(srcRow, { clientX: 12, clientY: 18 });
    await waitFor(() => {
      expect(onOpenItemContextMenu).toHaveBeenCalledTimes(1);
    });

    rerender(<LazyPierFileTree items={treeItems} label="Project files" />);
    await waitFor(() => {
      srcRow = within(getFileTree(container)).getByRole("treeitem", {
        name: SRC_NAME_PATTERN,
      });
      expect(srcRow).not.toHaveAttribute("aria-haspopup", "menu");
    });
    onOpenItemContextMenu.mockClear();
    fireEvent.contextMenu(srcRow, { clientX: 20, clientY: 24 });
    expect(onOpenItemContextMenu).not.toHaveBeenCalled();
  });

  it("does not automatically retry a failed compact-chain leaf", async () => {
    const onLoadDirectory = vi.fn<(path: string) => void>();
    const { container, rerender } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: true,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
        onLoadDirectory={onLoadDirectory}
      />
    );
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", {
        name: SRC_NAME_PATTERN,
      })
    );
    expect(onLoadDirectory).toHaveBeenCalledWith("src");

    rerender(
      <LazyPierFileTree
        directoryErrorLabel="Error"
        directoryStates={
          new Map([
            ["src", "loaded"],
            ["src/generated", "error"],
          ])
        }
        items={[
          { kind: "directory", path: "src", hasChildren: true },
          {
            kind: "directory",
            path: "src/generated",
            hasChildren: true,
          },
        ]}
        label="Project files"
        onLoadDirectory={onLoadDirectory}
      />
    );

    await waitFor(() => {
      expect(
        within(getFileTree(container)).getByText(DIRECTORY_ERROR_PATTERN)
      ).toBeVisible();
    });
    expect(onLoadDirectory).toHaveBeenCalledTimes(1);
  });

  it("does not load a known-empty directory when pointer activation expands it", () => {
    const onLoadDirectory = vi.fn<(path: string) => void>();
    const { container } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: false,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
        onLoadDirectory={onLoadDirectory}
      />
    );

    const tree = within(getFileTree(container));
    const srcRow = tree.getByRole("treeitem", { name: SRC_NAME_PATTERN });

    fireEvent.click(srcRow);

    expect(onLoadDirectory).not.toHaveBeenCalled();
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("does not issue duplicate loads when an unloaded directory is re-expanded before props change", () => {
    const onLoadDirectory = vi.fn<(path: string) => void>();
    const { container } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: true,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
        onLoadDirectory={onLoadDirectory}
      />
    );

    const tree = within(getFileTree(container));
    const srcRow = tree.getByRole("treeitem", { name: SRC_NAME_PATTERN });

    fireEvent.click(srcRow);
    expect(onLoadDirectory).toHaveBeenCalledTimes(1);
    expect(onLoadDirectory).toHaveBeenCalledWith("src");
    expect(srcRow).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(srcRow);
    expect(srcRow).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(srcRow);
    expect(srcRow).toHaveAttribute("aria-expanded", "true");
    expect(onLoadDirectory).toHaveBeenCalledTimes(1);
  });

  it("loads an unloaded directory by caller path when ArrowRight expands it", () => {
    const onLoadDirectory = vi.fn<(path: string) => void>();
    const { container } = render(
      <LazyPierFileTree
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: "unknown",
            loadState: "unloaded",
          },
        ]}
        label="Project files"
        onLoadDirectory={onLoadDirectory}
      />
    );

    const tree = within(getFileTree(container));
    const srcRow = tree.getByRole("treeitem", { name: SRC_NAME_PATTERN });

    srcRow.focus();
    fireEvent.keyDown(srcRow, { key: "ArrowRight" });

    expect(onLoadDirectory).toHaveBeenCalledTimes(1);
    expect(onLoadDirectory).toHaveBeenCalledWith("src");
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("keeps transient directory loading state out of the visible row label", async () => {
    const unloadedItems = [
      {
        kind: "directory",
        path: "src",
        hasChildren: true,
        loadState: "unloaded",
      },
    ] satisfies readonly LazyPierFileTreeItem[];
    const { container, rerender } = render(
      <LazyPierFileTree items={unloadedItems} label="Project files" />
    );
    const tree = within(getFileTree(container));

    expect(
      within(
        tree.getByRole("treeitem", { name: SRC_NAME_PATTERN })
      ).queryByText(DIRECTORY_LOADING_OR_ERROR_PATTERN)
    ).not.toBeInTheDocument();

    rerender(
      <LazyPierFileTree
        directoryStates={new Map([["src", "loading"]])}
        items={unloadedItems}
        label="Project files"
      />
    );

    await waitFor(() => {
      expect(
        within(
          tree.getByRole("treeitem", { name: SRC_NAME_PATTERN })
        ).queryByText(DIRECTORY_LOADING_OR_ERROR_PATTERN)
      ).not.toBeInTheDocument();
    });
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);

    rerender(
      <LazyPierFileTree
        directoryErrorLabel="Error"
        directoryStates={new Map([["src", "error"]])}
        items={unloadedItems}
        label="Project files"
      />
    );

    await waitFor(() => {
      expect(
        within(
          tree.getByRole("treeitem", { name: SRC_NAME_PATTERN })
        ).getByText(DIRECTORY_ERROR_PATTERN)
      ).toBeVisible();
    });
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("updates item loadState decorations after the initial render", async () => {
    const { container, rerender } = render(
      <LazyPierFileTree
        directoryErrorLabel="Error"
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: true,
            loadState: "unloaded",
          },
        ]}
        label="Project files"
      />
    );
    const tree = within(getFileTree(container));

    rerender(
      <LazyPierFileTree
        directoryErrorLabel="Error"
        items={[
          {
            kind: "directory",
            path: "src",
            hasChildren: true,
            loadState: "error",
          },
        ]}
        label="Project files"
      />
    );

    await waitFor(() => {
      expect(
        within(
          tree.getByRole("treeitem", { name: SRC_NAME_PATTERN })
        ).getByText(DIRECTORY_ERROR_PATTERN)
      ).toBeVisible();
    });
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);
  });
});
