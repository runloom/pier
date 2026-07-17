import type {
  FileTreeBatchOperation,
  FileTreeCompositionOptions,
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeRowDecoration,
} from "@pierre/trees";
import type * as React from "react";
import type {
  PierDirectoryLoadState,
  PierFileTreeItem,
} from "./file-tree-types.ts";

const TRAILING_SLASHES_PATTERN = /\/+$/;

export function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.replace(TRAILING_SLASHES_PATTERN, "") : path;
}

export function lastSegment(path: string): string {
  const trimmed = stripTrailingSlash(path);
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

export function toOfficialPath(item: PierFileTreeItem): string {
  return item.kind === "directory" && !item.path.endsWith("/")
    ? `${item.path}/`
    : item.path;
}

function getDefaultDirectoryLoadState(
  item: PierFileTreeItem
): PierDirectoryLoadState | undefined {
  if (item.hasChildren === true || item.hasChildren === "unknown") {
    return "unloaded";
  }
  return;
}

export function resolveDirectoryLoadState(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): PierDirectoryLoadState | undefined {
  if (item.kind !== "directory") {
    return;
  }
  if (item.hasChildren === false) {
    return "empty";
  }
  return (
    directoryStates?.get(item.path) ??
    directoryStates?.get(toOfficialPath(item)) ??
    item.loadState ??
    getDefaultDirectoryLoadState(item)
  );
}

function shouldAutoExpandDirectory(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): boolean {
  return resolveDirectoryLoadState(item, directoryStates) == null;
}

function toDirectoryLoadDecoration(
  loadState: PierDirectoryLoadState | undefined,
  errorLabel: string | undefined
): React.ReactNode {
  switch (loadState) {
    case "error":
      return errorLabel ?? null;
    default:
      return null;
  }
}

export function buildRowDecoration(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>,
  directoryErrorLabel?: string
): React.ReactNode {
  const parts: string[] = [];

  if (
    typeof item.trailingDecoration === "string" ||
    typeof item.trailingDecoration === "number"
  ) {
    parts.push(String(item.trailingDecoration));
  }

  const loadDecoration = toDirectoryLoadDecoration(
    resolveDirectoryLoadState(item, directoryStates),
    directoryErrorLabel
  );

  if (typeof loadDecoration === "string") {
    parts.push(loadDecoration);
  }

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return item.trailingDecoration ?? null;
}

export function toOfficialDecoration(
  decoration: React.ReactNode
): FileTreeRowDecoration | null {
  if (typeof decoration === "string" || typeof decoration === "number") {
    return { text: String(decoration) };
  }
  return null;
}

function rowRenderSignature(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): string {
  const trailingDecoration =
    typeof item.trailingDecoration === "string" ||
    typeof item.trailingDecoration === "number"
      ? String(item.trailingDecoration)
      : "";

  return [
    toOfficialPath(item),
    item.kind,
    resolveDirectoryLoadState(item, directoryStates) ?? "",
    trailingDecoration,
  ].join("\u0000");
}

export function treeRenderSignature(
  items: readonly PierFileTreeItem[],
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): string {
  return items
    .map((item) => rowRenderSignature(item, directoryStates))
    .join("\u0001");
}

export function cloneCompositionForRedraw(
  composition: FileTreeCompositionOptions | undefined
): FileTreeCompositionOptions {
  return {
    ...(composition?.contextMenu
      ? { contextMenu: { ...composition.contextMenu } }
      : {}),
    ...(composition?.header ? { header: { ...composition.header } } : {}),
  };
}

export function collectExpandedDirectoryPaths(
  items: readonly PierFileTreeItem[],
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): string[] {
  const expandedPaths = new Set<string>();

  for (const item of items) {
    const segments = item.path.split("/").filter(Boolean);
    const shouldIncludeOwnDirectory =
      item.kind === "directory" &&
      shouldAutoExpandDirectory(item, directoryStates);
    const directorySegmentCount =
      item.kind === "directory"
        ? segments.length - (shouldIncludeOwnDirectory ? 0 : 1)
        : segments.length - 1;

    for (let index = 1; index <= directorySegmentCount; index += 1) {
      expandedPaths.add(segments.slice(0, index).join("/"));
    }
  }

  return [...expandedPaths];
}

/**
 * resetPaths 会重建 @pierre/trees 内部 store。这里只恢复用户明确留下的展开态；
 * 新出现的单子目录链是唯一例外：压缩目录行的终点从父目录移动到新子目录时，
 * 把父目录的展开意图传到尚无用户状态的链尾，保证第一次展开即可看到内容。
 */
export function collectPreservedExpandedDirectoryPaths(
  items: readonly PierFileTreeItem[],
  expansionByOfficialPath: ReadonlyMap<string, boolean>,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): string[] {
  const normalizedExpansion = new Map<string, boolean>();
  for (const [path, expanded] of expansionByOfficialPath) {
    normalizedExpansion.set(stripTrailingSlash(path), expanded);
  }

  const childrenByParent = new Map<
    string,
    Array<{
      kind: PierFileTreeItem["kind"];
      loadState: PierDirectoryLoadState | undefined;
      path: string;
    }>
  >();
  for (const item of items) {
    const path = stripTrailingSlash(item.path);
    const slash = path.lastIndexOf("/");
    const parent = slash < 0 ? "" : path.slice(0, slash);
    const children = childrenByParent.get(parent) ?? [];
    children.push({
      kind: item.kind,
      loadState: resolveDirectoryLoadState(item, directoryStates),
      path,
    });
    childrenByParent.set(parent, children);
  }

  const hasCollapsedAncestor = (path: string): boolean => {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      if (
        normalizedExpansion.get(segments.slice(0, index).join("/")) === false
      ) {
        return true;
      }
    }
    return false;
  };

  const expandedPaths = new Set<string>();
  for (const [path, expanded] of normalizedExpansion) {
    if (expanded) {
      expandedPaths.add(path);
    }
  }
  for (const path of collectExpandedDirectoryPaths(items, directoryStates)) {
    if (normalizedExpansion.has(path) || hasCollapsedAncestor(path)) {
      continue;
    }
    expandedPaths.add(path);
  }

  for (const headPath of [...expandedPaths]) {
    let currentPath = headPath;
    while (true) {
      const children = childrenByParent.get(currentPath);
      const onlyChild = children?.length === 1 ? children[0] : undefined;
      if (onlyChild?.kind !== "directory" || onlyChild.loadState === "error") {
        break;
      }
      const explicitState = normalizedExpansion.get(onlyChild.path);
      if (explicitState === false) {
        break;
      }
      expandedPaths.add(onlyChild.path);
      currentPath = onlyChild.path;
    }
  }

  return [...expandedPaths];
}

export function isDirectoryHandle(
  itemHandle: FileTreeItemHandle | null
): itemHandle is FileTreeDirectoryHandle {
  return itemHandle?.isDirectory() === true;
}

export function samePaths(
  previousPaths: readonly string[],
  nextPaths: readonly string[]
): boolean {
  return (
    previousPaths.length === nextPaths.length &&
    previousPaths.every((path, index) => path === nextPaths[index])
  );
}

export function pathSetMutation(
  previousPaths: readonly string[],
  nextPaths: readonly string[]
): FileTreeBatchOperation[] | null {
  const previousPathSet = new Set(previousPaths);
  const nextPathSet = new Set(nextPaths);
  const removedPaths = previousPaths.filter((path) => !nextPathSet.has(path));
  const addedPaths = nextPaths.filter((path) => !previousPathSet.has(path));

  if (removedPaths.length === 0 && addedPaths.length === 0) {
    return null;
  }

  const addedPath = addedPaths[0];
  const removedPath = removedPaths[0];
  if (
    removedPaths.length === 1 &&
    addedPaths.length === 1 &&
    removedPath !== undefined &&
    addedPath !== undefined
  ) {
    const parentOf = (path: string) => {
      const normalized = stripTrailingSlash(path);
      const slash = normalized.lastIndexOf("/");
      return slash === -1 ? "" : normalized.slice(0, slash);
    };
    if (parentOf(removedPath) === parentOf(addedPath)) {
      return [{ from: removedPath, to: addedPath, type: "move" }];
    }
  }

  return [
    ...removedPaths.map(
      (path): FileTreeBatchOperation => ({ path, type: "remove" })
    ),
    ...addedPaths.map(
      (path): FileTreeBatchOperation => ({ path, type: "add" })
    ),
  ];
}
