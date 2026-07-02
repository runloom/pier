import {
  PierFileTree,
  type PierFileTreeGitStatus,
  type PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

const SRC_NAME_PATTERN = /src/;
const APP_TSX_NAME_PATTERN = /app\.tsx/;
const README_NAME_PATTERN = /README\.md/;
const DIRECTORY_LOADING_OR_ERROR_PATTERN = /loading|error/i;
const DIRECTORY_LOADING_PATTERN = /loading/i;
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
  it("renders the official file-tree host as the root element", () => {
    const { container } = render(
      <PierFileTree items={items} label="Project files" />
    );

    const host = getFileTreeHost(container);
    expect(host?.tagName.toLowerCase()).toBe("file-tree-container");
    expect(container.firstElementChild).toBe(host);
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

  it("updates directory state decorations after the initial render", async () => {
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
        ).getByText(DIRECTORY_LOADING_PATTERN)
      ).toBeVisible();
    });
    expect(tree.getAllByRole("treeitem")).toHaveLength(1);

    rerender(
      <LazyPierFileTree
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
