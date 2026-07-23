import { type FileDiffMetadata, processFile } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";

export interface PierDiffViewFileDisplay {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: "added" | "conflicted" | "deleted" | "modified" | "renamed";
}

/** Uncommitted header actions; omit/null = no stage cluster. */
export interface PierDiffViewStageControl {
  readonly busy?: boolean;
  /** Unstaged modified/deleted may offer discard (restore). */
  readonly canDiscard?: boolean;
  readonly state: "staged" | "unstaged";
}

export interface PierDiffViewItem {
  readonly cacheKey: string;
  readonly fileDisplay?: PierDiffViewFileDisplay;
  readonly id: string;
  /**
   * null = loading 占位或非文本 state（仅文件头）。
   * 有 `stateNotice` 时为 ready 空正文（二进制/子模块等），不是 loading。
   * 非 null = 可渲染文本 patch 正文。
   */
  readonly patch: string | null;
  readonly stageControl?: PierDiffViewStageControl | null;
  /**
   * 非文本变更说明（binary / symlink / submodule…）。
   * 业界 multi-diff：只保留 header + 说明，不伪造代码行。
   */
  readonly stateNotice?: string;
}

/** 与 Pierre 官方 header 一致：按 hunk.additionLines / deletionLines 汇总。 */
export function fileDiffLineStats(fileDiff: {
  readonly hunks: readonly {
    readonly additionLines: number;
    readonly deletionLines: number;
  }[];
}): { readonly additions: number; readonly deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

export interface ParsedItemCacheEntry {
  readonly cacheKey: string;
  readonly item: CodeViewItem;
  readonly version: number;
}

export interface PierDiffViewItemError {
  readonly error: Error;
  readonly id: string;
}

export function toCodeViewItem(
  input: PierDiffViewItem,
  previous: ParsedItemCacheEntry | undefined
): { readonly entry: ParsedItemCacheEntry; readonly error: Error | null } {
  try {
    const fileDiff =
      input.patch === null ? placeholderFileDiff(input) : parsedFileDiff(input);
    const version = (previous?.version ?? -1) + 1;
    const item: CodeViewItem = {
      fileDiff,
      id: input.id,
      type: "diff",
      version,
    };
    return {
      entry: { cacheKey: input.cacheKey, item, version },
      error: null,
    };
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    if (previous) {
      return { entry: previous, error: normalized };
    }
    const version = 0;
    const item: CodeViewItem = {
      fileDiff: placeholderFileDiff(input),
      id: input.id,
      type: "diff",
      version,
    };
    return {
      entry: { cacheKey: input.cacheKey, item, version },
      error: normalized,
    };
  }
}

function fileDisplayType(
  status: PierDiffViewFileDisplay["status"]
): FileDiffMetadata["type"] {
  switch (status) {
    case "added":
      return "new";
    case "deleted":
      return "deleted";
    case "renamed":
      return "rename-changed";
    case "conflicted":
    case "modified":
      return "change";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function applyFileDisplay(
  fileDiff: FileDiffMetadata,
  display: PierDiffViewFileDisplay | undefined
): FileDiffMetadata {
  if (!display) {
    return fileDiff;
  }
  return {
    ...fileDiff,
    name: display.path,
    type: fileDisplayType(display.status),
    ...(display.previousPath === undefined
      ? {}
      : { prevName: display.previousPath }),
  };
}

export function toCodeViewItems(
  inputs: readonly PierDiffViewItem[],
  cache: Map<string, ParsedItemCacheEntry>
): {
  cache: Map<string, ParsedItemCacheEntry>;
  errors: readonly PierDiffViewItemError[];
  items: CodeViewItem[];
} {
  const items: CodeViewItem[] = [];
  const nextCache = new Map<string, ParsedItemCacheEntry>();
  const errors: PierDiffViewItemError[] = [];
  for (const input of inputs) {
    const previous = cache.get(input.id);
    if (previous?.cacheKey === input.cacheKey) {
      items.push(previous.item);
      nextCache.set(input.id, previous);
      continue;
    }
    const parsed = toCodeViewItem(input, previous);
    items.push(parsed.entry.item);
    nextCache.set(input.id, parsed.entry);
    if (parsed.error) {
      errors.push({ error: parsed.error, id: input.id });
    }
  }
  return { cache: nextCache, errors, items };
}

function parsedFileDiff(input: PierDiffViewItem): FileDiffMetadata {
  if (input.patch === null) {
    throw new Error(`Pierre diff item has no patch: ${input.id}`);
  }
  const parsed = processFile(input.patch, {
    cacheKey: input.cacheKey,
    isGitDiff: true,
    throwOnError: true,
  });
  if (!parsed) {
    throw new Error(`Pierre did not parse diff item: ${input.id}`);
  }
  return applyFileDisplay(parsed, input.fileDisplay);
}

function placeholderFileDiff(input: PierDiffViewItem): FileDiffMetadata {
  const display = input.fileDisplay;
  if (!display) {
    throw new Error(`Pierre placeholder is missing file display: ${input.id}`);
  }
  // loading 槽：保留稳定 section 身份与虚拟列表几何，但不冒充 ready diff。
  // header 折叠/统计由 presentation=loading 接管，避免 -0/+0 与假收起。
  return {
    additionLines: [],
    cacheKey: input.cacheKey,
    deletionLines: [],
    hunks: [],
    isPartial: true,
    name: display.path,
    ...(display.previousPath === undefined
      ? {}
      : { prevName: display.previousPath }),
    splitLineCount: 0,
    type: fileDisplayType(display.status),
    unifiedLineCount: 0,
  };
}
