import type {
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
} from "@pierre/trees";
import { isDirectoryHandle, toOfficialPath } from "./file-tree-model.ts";
import type {
  PierFileTreeItem,
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
} from "./file-tree-types.ts";

export type {
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
} from "./file-tree-types.ts";

export interface PierFileTreeRevealModel {
  focusNearestPath?: (path: string | null) => string | null;
  focusPath: (path: string) => void;
  getFileTreeContainer?: () => HTMLElement | undefined;
  getItem: (
    path: string
  ) => FileTreeItemHandle | FileTreeDirectoryHandle | null;
  getSelectedPaths?: () => readonly string[];
  scrollToPath: (
    path: string,
    options?: { focus?: boolean; offset?: PierFileTreeRevealScroll }
  ) => void;
  selectOnlyPath: (path: string) => void;
}

export interface PierFileTreeRevealRefs {
  itemsByPath:
    | Map<string, PierFileTreeItem>
    | ReadonlyMap<string, PierFileTreeItem>;
}

/**
 * Shared VS Code-like reveal: expand ancestors → expand folder → select+focus
 * (focus ring) → scroll. Never opens a file (caller owns programmaticSelection).
 *
 * With `flattenEmptyDirectories`, intermediate dirs in a single-child chain are
 * not visible rows — only the chain terminal is. Reveal must target that row.
 */
export function revealFileTreePath(
  model: PierFileTreeRevealModel,
  readRefs: () => PierFileTreeRevealRefs,
  programmaticSelectionRef: { current: { path: string } | null },
  path: string,
  options?: PierFileTreeRevealOptions
): boolean {
  const scroll = options?.scroll ?? "center";
  const expandTarget = options?.expandTarget !== false;

  if (path === "") {
    return revealProjectRoot(model, readRefs, programmaticSelectionRef);
  }

  expandAncestorDirectories(model, readRefs, path);

  const item = readRefs().itemsByPath.get(path);
  if (!item) {
    return false;
  }

  // Compact-folder chains only expose the terminal directory as a tree row.
  const revealItemPath =
    item.kind === "directory"
      ? resolveCompactChainTerminalPath(readRefs().itemsByPath, item.path)
      : item.path;
  const revealItem =
    readRefs().itemsByPath.get(revealItemPath) ??
    (revealItemPath === item.path ? item : null);
  if (!revealItem) {
    return false;
  }

  const officialPath = toOfficialPath(revealItem);
  try {
    if (expandTarget && revealItem.kind === "directory") {
      const handle = model.getItem(officialPath);
      if (isDirectoryHandle(handle) && !handle.isExpanded()) {
        handle.expand();
      }
    }
    applyProgrammaticSelectAndFocus(
      model,
      programmaticSelectionRef,
      officialPath
    );
    model.scrollToPath(officialPath, { focus: false, offset: scroll });
    // Controller focus is not enough: trees only paints the blue ring when the
    // row button holds DOM focus (`visualFocusPath` / `activeItemPath`).
    focusRevealedRow(model, officialPath);
    return isPathSelected(model, officialPath);
  } catch {
    return false;
  }
}

/**
 * Walk a single-child directory chain to the terminal path that `@pierre/trees`
 * actually renders when `flattenEmptyDirectories` is enabled.
 */
export function resolveCompactChainTerminalPath(
  itemsByPath: ReadonlyMap<string, PierFileTreeItem>,
  directoryPath: string
): string {
  const items = uniqueItems(itemsByPath);
  let current = directoryPath;
  while (true) {
    const children = items.filter(
      (item) => parentPathOf(item.path) === current
    );
    if (children.length !== 1) {
      return current;
    }
    const onlyChild = children[0];
    if (onlyChild?.kind !== "directory") {
      return current;
    }
    current = onlyChild.path;
  }
}

function uniqueItems(
  itemsByPath: ReadonlyMap<string, PierFileTreeItem>
): PierFileTreeItem[] {
  const seen = new Set<string>();
  const items: PierFileTreeItem[] = [];
  for (const item of itemsByPath.values()) {
    if (seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    items.push(item);
  }
  return items;
}

function parentPathOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function revealProjectRoot(
  model: PierFileTreeRevealModel,
  readRefs: () => PierFileTreeRevealRefs,
  programmaticSelectionRef: { current: { path: string } | null }
): boolean {
  for (const [entryPath, entryItem] of readRefs().itemsByPath) {
    if (entryPath.includes("/")) {
      continue;
    }
    const terminalPath =
      entryItem.kind === "directory"
        ? resolveCompactChainTerminalPath(
            readRefs().itemsByPath,
            entryItem.path
          )
        : entryItem.path;
    const terminalItem = readRefs().itemsByPath.get(terminalPath) ?? entryItem;
    const officialRootPath = toOfficialPath(terminalItem);
    try {
      applyProgrammaticSelectAndFocus(
        model,
        programmaticSelectionRef,
        officialRootPath
      );
      model.scrollToPath(officialRootPath, {
        focus: false,
        offset: "top",
      });
      focusRevealedRow(model, officialRootPath);
      return isPathSelected(model, officialRootPath);
    } catch {
      return false;
    }
  }
  return false;
}

function expandAncestorDirectories(
  model: PierFileTreeRevealModel,
  readRefs: () => PierFileTreeRevealRefs,
  path: string
): void {
  const segments = path.split("/").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index).join("/");
    const ancestorItem = readRefs().itemsByPath.get(ancestorPath);
    if (!ancestorItem) {
      continue;
    }
    const handle = model.getItem(toOfficialPath(ancestorItem));
    if (isDirectoryHandle(handle) && !handle.isExpanded()) {
      handle.expand();
    }
  }
}

function applyProgrammaticSelectAndFocus(
  model: PierFileTreeRevealModel,
  programmaticSelectionRef: { current: { path: string } | null },
  officialPath: string
): void {
  const programmaticSelection = { path: officialPath };
  programmaticSelectionRef.current = programmaticSelection;
  try {
    model.selectOnlyPath(officialPath);
    model.focusPath(officialPath);
  } finally {
    queueMicrotask(() => {
      if (programmaticSelectionRef.current === programmaticSelection) {
        programmaticSelectionRef.current = null;
      }
    });
  }
}

function isPathSelected(
  model: PierFileTreeRevealModel,
  officialPath: string
): boolean {
  const selected = model.getSelectedPaths?.();
  if (!selected) {
    return true;
  }
  const normalized = stripTrailingSlash(officialPath);
  return selected.some(
    (selectedPath) => stripTrailingSlash(selectedPath) === normalized
  );
}

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function focusRevealedRow(
  model: PierFileTreeRevealModel,
  officialPath: string
): void {
  const focusRow = () => {
    const container = model.getFileTreeContainer?.();
    if (!container) {
      return;
    }
    const root: ParentNode = container.shadowRoot ?? container;
    const candidates = [
      officialPath,
      stripTrailingSlash(officialPath),
      officialPath.endsWith("/") ? officialPath : `${officialPath}/`,
    ];
    for (const candidate of candidates) {
      const row = root.querySelector(
        `[data-item-path="${cssEscape(candidate)}"]`
      );
      if (row instanceof HTMLElement) {
        row.focus({ preventScroll: true });
        return;
      }
    }
  };
  focusRow();
  queueMicrotask(focusRow);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      focusRow();
      requestAnimationFrame(focusRow);
    });
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replaceAll(/\\/g, "\\\\").replaceAll(/"/g, '\\"');
}
