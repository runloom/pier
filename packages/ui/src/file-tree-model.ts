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
  loadState: PierDirectoryLoadState | undefined
): React.ReactNode {
  switch (loadState) {
    case "loading":
      return "Loading";
    case "error":
      return "Error";
    case "empty":
      return "Empty";
    default:
      return null;
  }
}

export function buildRowDecoration(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): React.ReactNode {
  const parts: string[] = [];

  if (
    typeof item.trailingDecoration === "string" ||
    typeof item.trailingDecoration === "number"
  ) {
    parts.push(String(item.trailingDecoration));
  }

  const loadDecoration = toDirectoryLoadDecoration(
    resolveDirectoryLoadState(item, directoryStates)
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

export function singlePathMutation(
  previousPaths: readonly string[],
  nextPaths: readonly string[]
): FileTreeBatchOperation[] | null {
  const previousPathSet = new Set(previousPaths);
  const nextPathSet = new Set(nextPaths);
  const removedPaths = previousPaths.filter((path) => !nextPathSet.has(path));
  const addedPaths = nextPaths.filter((path) => !previousPathSet.has(path));

  const addedPath = addedPaths[0];
  const removedPath = removedPaths[0];

  if (
    removedPaths.length === 0 &&
    addedPaths.length === 1 &&
    addedPath !== undefined
  ) {
    return [{ path: addedPath, type: "add" }];
  }

  if (
    removedPaths.length === 1 &&
    addedPaths.length === 0 &&
    removedPath !== undefined
  ) {
    return [{ path: removedPath, type: "remove" }];
  }

  if (
    removedPaths.length === 1 &&
    addedPaths.length === 1 &&
    removedPath !== undefined &&
    addedPath !== undefined
  ) {
    return [{ from: removedPath, to: addedPath, type: "move" }];
  }

  return null;
}
