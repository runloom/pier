import {
  type PierFileTreeRevealModel,
  resolveCompactChainTerminalPath,
  revealFileTreePath,
} from "@pier/ui/file-tree-reveal.ts";
import type { PierFileTreeItem } from "@pier/ui/file-tree-types.ts";
import { describe, expect, it, vi } from "vitest";

function directoryHandle(expanded: boolean) {
  return {
    expand: vi.fn(),
    isDirectory: () => true,
    isExpanded: () => expanded,
  };
}

function createModel() {
  const focusPath = vi.fn();
  const scrollToPath = vi.fn();
  const selectOnlyPath = vi.fn();
  const getItem = vi.fn();
  const selected: string[] = [];
  selectOnlyPath.mockImplementation((path: string) => {
    selected.length = 0;
    selected.push(path);
  });
  const model: PierFileTreeRevealModel = {
    focusPath,
    getItem,
    getSelectedPaths: () => selected,
    scrollToPath,
    selectOnlyPath,
  };
  return { focusPath, getItem, model, scrollToPath, selectOnlyPath };
}

describe("resolveCompactChainTerminalPath", () => {
  it("walks single-child directory chains to the visible terminal", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/preload", { kind: "directory", path: "src/preload" }],
      [
        "src/preload/ai-api.ts",
        { kind: "file", path: "src/preload/ai-api.ts" },
      ],
    ]);
    expect(resolveCompactChainTerminalPath(itemsByPath, "src")).toBe(
      "src/preload"
    );
    expect(resolveCompactChainTerminalPath(itemsByPath, "src/preload")).toBe(
      "src/preload"
    );
  });

  it("stops when a directory has multiple children", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/preload", { kind: "directory", path: "src/preload" }],
      ["src/main", { kind: "directory", path: "src/main" }],
    ]);
    expect(resolveCompactChainTerminalPath(itemsByPath, "src")).toBe("src");
  });
});

describe("revealFileTreePath", () => {
  it("selects, focuses, and scrolls a file without expanding a target file", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/app.tsx", { kind: "file", path: "src/app.tsx" }],
    ]);
    const { focusPath, getItem, model, scrollToPath, selectOnlyPath } =
      createModel();
    const srcHandle = directoryHandle(false);
    getItem.mockImplementation((path: string) => {
      if (path === "src/" || path === "src") {
        return srcHandle;
      }
      return {
        isDirectory: () => false,
        kind: "file" as const,
      };
    });

    const ok = revealFileTreePath(
      model,
      () => ({ itemsByPath }),
      { current: null },
      "src/app.tsx",
      { scroll: "center" }
    );

    expect(ok).toBe(true);
    expect(srcHandle.expand).toHaveBeenCalledTimes(1);
    expect(scrollToPath).toHaveBeenCalledWith("src/app.tsx", {
      focus: false,
      offset: "center",
    });
    expect(selectOnlyPath).toHaveBeenCalledWith("src/app.tsx");
    expect(focusPath).toHaveBeenCalledWith("src/app.tsx");
  });

  it("expands a directory target and selects it", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/main.ts", { kind: "file", path: "src/main.ts" }],
    ]);
    const { focusPath, getItem, model, scrollToPath, selectOnlyPath } =
      createModel();
    const srcHandle = directoryHandle(false);
    getItem.mockReturnValue(srcHandle);

    const ok = revealFileTreePath(
      model,
      () => ({ itemsByPath }),
      { current: null },
      "src",
      { expandTarget: true, scroll: "center" }
    );

    expect(ok).toBe(true);
    expect(srcHandle.expand).toHaveBeenCalledTimes(1);
    expect(selectOnlyPath).toHaveBeenCalledWith("src/");
    expect(focusPath).toHaveBeenCalledWith("src/");
    expect(scrollToPath).toHaveBeenCalledWith("src/", {
      focus: false,
      offset: "center",
    });
  });

  it("selects the compact-chain terminal when revealing a flattened head", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/preload", { kind: "directory", path: "src/preload" }],
      [
        "src/preload/ai-api.ts",
        { kind: "file", path: "src/preload/ai-api.ts" },
      ],
    ]);
    const { getItem, model, selectOnlyPath } = createModel();
    const preloadHandle = directoryHandle(false);
    getItem.mockImplementation((path: string) => {
      if (path === "src/" || path === "src") {
        return directoryHandle(false);
      }
      if (path === "src/preload/" || path === "src/preload") {
        return preloadHandle;
      }
      return { isDirectory: () => false };
    });

    expect(
      revealFileTreePath(
        model,
        () => ({ itemsByPath }),
        { current: null },
        "src",
        { expandTarget: true, scroll: "center" }
      )
    ).toBe(true);
    expect(selectOnlyPath).toHaveBeenCalledWith("src/preload/");
    expect(preloadHandle.expand).toHaveBeenCalled();
  });

  it("does not expand the directory target when expandTarget is false", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/main.ts", { kind: "file", path: "src/main.ts" }],
    ]);
    const { getItem, model } = createModel();
    const srcHandle = directoryHandle(false);
    getItem.mockReturnValue(srcHandle);

    revealFileTreePath(
      model,
      () => ({ itemsByPath }),
      { current: null },
      "src",
      { expandTarget: false, scroll: "nearest" }
    );

    expect(srcHandle.expand).not.toHaveBeenCalled();
  });

  it("returns false when the path is not in the model yet", () => {
    const { model, selectOnlyPath } = createModel();
    const ok = revealFileTreePath(
      model,
      () => ({ itemsByPath: new Map() }),
      { current: null },
      "missing/file.ts"
    );
    expect(ok).toBe(false);
    expect(selectOnlyPath).not.toHaveBeenCalled();
  });

  it("focuses the revealed row DOM when getFileTreeContainer is provided", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src/app.tsx", { kind: "file", path: "src/app.tsx" }],
    ]);
    const { getItem, model } = createModel();
    getItem.mockReturnValue({
      isDirectory: () => false,
      kind: "file" as const,
    });

    const row = document.createElement("button");
    row.setAttribute("data-item-path", "src/app.tsx");
    row.tabIndex = -1;
    const focus = vi.spyOn(row, "focus");

    const host = document.createElement(
      "file-tree-container"
    ) as HTMLElement & {
      shadowRoot: ShadowRoot | null;
    };
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(row);
    document.body.append(host);

    const ok = revealFileTreePath(
      {
        ...model,
        getFileTreeContainer: () => host,
      },
      () => ({ itemsByPath }),
      { current: null },
      "src/app.tsx"
    );

    expect(ok).toBe(true);
    expect(focus).toHaveBeenCalled();
    host.remove();
  });

  it("reveals the first top-level item for empty project-root path", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["README.md", { kind: "file", path: "README.md" }],
      ["src/app.tsx", { kind: "file", path: "src/app.tsx" }],
    ]);
    const { focusPath, model, scrollToPath, selectOnlyPath } = createModel();

    const ok = revealFileTreePath(
      model,
      () => ({ itemsByPath }),
      { current: null },
      ""
    );

    expect(ok).toBe(true);
    expect(scrollToPath).toHaveBeenCalledWith("README.md", {
      focus: false,
      offset: "top",
    });
    expect(selectOnlyPath).toHaveBeenCalledWith("README.md");
    expect(focusPath).toHaveBeenCalledWith("README.md");
  });

  it("maps breadcrumb-style nested paths like src/preload/ai-api.ts", () => {
    const itemsByPath = new Map<string, PierFileTreeItem>([
      ["src", { kind: "directory", path: "src" }],
      ["src/preload", { kind: "directory", path: "src/preload" }],
      ["src/main.ts", { kind: "file", path: "src/main.ts" }],
      [
        "src/preload/ai-api.ts",
        { kind: "file", path: "src/preload/ai-api.ts" },
      ],
    ]);
    const { focusPath, getItem, model, selectOnlyPath } = createModel();
    const srcHandle = directoryHandle(false);
    const preloadHandle = directoryHandle(false);
    getItem.mockImplementation((path: string) => {
      if (path === "src/" || path === "src") {
        return srcHandle;
      }
      if (path === "src/preload/" || path === "src/preload") {
        return preloadHandle;
      }
      return { isDirectory: () => false };
    });

    expect(
      revealFileTreePath(
        model,
        () => ({ itemsByPath }),
        { current: null },
        "src/preload",
        { expandTarget: true, scroll: "center" }
      )
    ).toBe(true);
    expect(srcHandle.expand).toHaveBeenCalled();
    expect(preloadHandle.expand).toHaveBeenCalled();
    expect(selectOnlyPath).toHaveBeenCalledWith("src/preload/");
    expect(focusPath).toHaveBeenCalledWith("src/preload/");

    selectOnlyPath.mockClear();
    expect(
      revealFileTreePath(
        model,
        () => ({ itemsByPath }),
        { current: null },
        "src/preload/ai-api.ts",
        { expandTarget: false, scroll: "center" }
      )
    ).toBe(true);
    expect(selectOnlyPath).toHaveBeenCalledWith("src/preload/ai-api.ts");
  });
});
