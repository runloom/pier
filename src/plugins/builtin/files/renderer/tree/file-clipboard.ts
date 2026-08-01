/**
 * 文件树内部剪贴板（Cut/Copy/Paste 文件，非系统文本剪贴板）。
 * 单 renderer 进程共享；与 Duplicate（就地副本）语义不同。
 */

export type FilesTreeClipboardMode = "copy" | "cut";

export interface FilesTreeClipboardEntry {
  kind: "directory" | "file";
  path: string;
}

export interface FilesTreeClipboardState {
  entries: readonly FilesTreeClipboardEntry[];
  mode: FilesTreeClipboardMode;
  root: string;
}

let clipboard: FilesTreeClipboardState | null = null;

export function readFilesTreeClipboard(): FilesTreeClipboardState | null {
  return clipboard;
}

export function writeFilesTreeClipboard(state: FilesTreeClipboardState): void {
  clipboard = {
    entries: state.entries.map((entry) => ({ ...entry })),
    mode: state.mode,
    root: state.root,
  };
}

export function clearFilesTreeClipboard(): void {
  clipboard = null;
}

export function hasFilesTreeClipboard(): boolean {
  return clipboard != null && clipboard.entries.length > 0;
}

/**
 * 多选剪枝：去掉已被另一选中路径作为祖先覆盖的路径（Finder / VS Code 语义）。
 * 例如同时选中 `src/` 与 `src/a.ts` 时只保留 `src/`。
 */
export function pruneNestedClipboardEntries(
  entries: readonly FilesTreeClipboardEntry[]
): FilesTreeClipboardEntry[] {
  if (entries.length <= 1) {
    return entries.map((entry) => ({ ...entry }));
  }
  const sorted = [...entries].sort((left, right) => {
    const byLength = left.path.length - right.path.length;
    return byLength === 0 ? left.path.localeCompare(right.path) : byLength;
  });
  const kept: FilesTreeClipboardEntry[] = [];
  for (const entry of sorted) {
    const nested = kept.some(
      (parent) =>
        entry.path === parent.path || entry.path.startsWith(`${parent.path}/`)
    );
    if (!nested) {
      kept.push({ ...entry });
    }
  }
  return kept;
}

/** 目标父目录是 entry 自身或其子孙 → 不能 paste（cut/copy 均禁）。 */
export function isPasteIntoSelfOrDescendant(
  parentDir: string,
  entryPath: string
): boolean {
  return parentDir === entryPath || parentDir.startsWith(`${entryPath}/`);
}

/** paste 目标父目录（相对 root）；文件行 → 父目录；目录行 → 自身；空白 → 根。 */
export function resolvePasteParentDir(input: {
  kind?: "directory" | "file";
  path?: string;
}): string {
  if (input.path === undefined) {
    return "";
  }
  if (input.kind === "directory") {
    return input.path;
  }
  const slash = input.path.lastIndexOf("/");
  return slash < 0 ? "" : input.path.slice(0, slash);
}

export function joinRelativeChild(parentDir: string, name: string): string {
  return parentDir.length > 0 ? `${parentDir}/${name}` : name;
}

export function basenameRelative(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}
