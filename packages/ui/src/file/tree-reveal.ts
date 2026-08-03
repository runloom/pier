import type {
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
} from "@pierre/trees";
import { isDirectoryHandle, toOfficialPath } from "./tree-model.ts";
import type {
  PierFileTreeItem,
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
} from "./tree-types.ts";

export type {
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
} from "./tree-types.ts";

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
    options?: {
      focus?: boolean;
      offset?: Exclude<PierFileTreeRevealScroll, "none">;
    }
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
 *
 * Success when scroll is requested requires ancestors to be expanded so the row
 * can enter the virtual projection; otherwise `scrollToPath` silently no-ops and
 * callers would stop retrying (first-open deep path bug).
 */
export function revealFileTreePath(
  model: PierFileTreeRevealModel,
  readRefs: () => PierFileTreeRevealRefs,
  programmaticSelectionRef: { current: { path: string } | null },
  path: string,
  options?: PierFileTreeRevealOptions
): boolean {
  // Defaults match explicit intent; prefer resolveRevealPolicy at the call site.
  // Empty path is root intent → default top (not center).
  const scroll =
    path === "" ? (options?.scroll ?? "top") : (options?.scroll ?? "center");
  const expandTarget = options?.expandTarget !== false;

  if (path === "") {
    return revealProjectRoot(model, readRefs, programmaticSelectionRef, scroll);
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
    // Expand again after target expand — projection may need the full chain.
    expandAncestorDirectories(model, readRefs, path);

    if (
      scroll !== "none" &&
      !areRevealAncestorsExpanded(model, readRefs, path)
    ) {
      // Path is known but still collapsed in the model — keep pending retry.
      // Still select so the user may see progress when the row becomes visible.
      applyProgrammaticSelectAndFocus(
        model,
        programmaticSelectionRef,
        officialPath
      );
      return false;
    }

    applyProgrammaticSelectAndFocus(
      model,
      programmaticSelectionRef,
      officialPath
    );
    // `none` = select+focus only (autoReveal "select" / policy).
    // Explicit `center` always recenters (optimal reading zone).
    if (scroll !== "none") {
      model.scrollToPath(officialPath, { focus: false, offset: scroll });
    }
    // Controller focus is not enough: trees only paints the blue ring when the
    // row button holds DOM focus (`visualFocusPath` / `activeItemPath`).
    if (options?.preserveFocus !== true) {
      focusRevealedRow(model, officialPath);
    }
    if (!isPathSelected(model, officialPath)) {
      return false;
    }
    // Select-only mode is done once selected.
    if (scroll === "none") {
      return true;
    }
    // Scroll path: ancestors expanded (scrollToPath can work) OR the row is
    // already in the DOM (compact/lazy intermediates may skip map entries).
    if (areRevealAncestorsExpanded(model, readRefs, path)) {
      return true;
    }
    return queryRevealedRow(model, officialPath) != null;
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

/**
 * True when every *projected* ancestor directory of `path` is expanded.
 * Missing intermediates (compact/lazy not yet listed) are skipped; the immediate
 * parent of the leaf, when projected, must still be expanded so scrollToPath
 * can place the row.
 */
export function areRevealAncestorsExpanded(
  model: PierFileTreeRevealModel,
  readRefs: () => PierFileTreeRevealRefs,
  path: string
): boolean {
  const segments = path.split("/").filter(Boolean);
  // Root-level file/dir has no ancestors to expand.
  if (segments.length <= 1) {
    return true;
  }
  const itemsByPath = readRefs().itemsByPath;
  let projectedAncestorCount = 0;
  for (let index = 1; index < segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index).join("/");
    const ancestorItem = itemsByPath.get(ancestorPath);
    if (!ancestorItem) {
      // Not in projection yet (lazy) — do not fail the whole chain here.
      continue;
    }
    if (ancestorItem.kind !== "directory") {
      return false;
    }
    projectedAncestorCount += 1;
    const handle = model.getItem(toOfficialPath(ancestorItem));
    if (!(isDirectoryHandle(handle) && handle.isExpanded())) {
      return false;
    }
  }
  // Immediate parent must be projected and expanded when the leaf is nested.
  const parentPath = segments.slice(0, -1).join("/");
  if (parentPath.length > 0 && !itemsByPath.get(parentPath)) {
    return false;
  }
  // At least the parent (or some ancestor) should have been checked when nested.
  return projectedAncestorCount > 0 || parentPath.length === 0;
}

/**
 * Ancestor directory paths that must be expanded for `path` to be revealable
 * (excludes the path itself).
 */
export function revealAncestorDirectoryPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
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
  programmaticSelectionRef: { current: { path: string } | null },
  scroll: PierFileTreeRevealScroll = "top"
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
      if (scroll !== "none") {
        model.scrollToPath(officialRootPath, {
          focus: false,
          offset: scroll === "center" || scroll === "nearest" ? scroll : "top",
        });
      }
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
  for (const ancestorPath of revealAncestorDirectoryPaths(path)) {
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

function queryRevealedRow(
  model: PierFileTreeRevealModel,
  officialPath: string
): HTMLElement | null {
  const container = model.getFileTreeContainer?.();
  if (!container) {
    return null;
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
      return row;
    }
  }
  return null;
}

function focusRevealedRow(
  model: PierFileTreeRevealModel,
  officialPath: string
): void {
  const focusRow = () => {
    const row = queryRevealedRow(model, officialPath);
    if (row) {
      row.focus({ preventScroll: true });
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
