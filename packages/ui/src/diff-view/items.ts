import { type FileDiffMetadata, processFile } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";
import type { PierHunkAnnotationMetadata } from "./hunk-actions.tsx";
import { buildHunkActionAnnotations } from "./hunk-annotations.ts";

export {
  buildHunkActionAnnotations,
  type HunkAnnotationAnchor,
  hunkAnnotationAnchor,
  hunkChangeBlockAnchors,
} from "./hunk-annotations.ts";

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
  /** 精确标识触发等待态的按钮；busy 可仅表示全局禁用。 */
  readonly pendingAction?: "discard" | "stage" | "unstage";
  readonly state: "partial" | "staged" | "unstaged";
  /** 视图稳定 id 与 Git 语义 sectionKey 不同时使用。 */
  readonly targetSectionKey?: string;
}

/** Per-change Git state; hunk indexes are presentation coordinates only. */
export interface PierDiffViewChangeControl {
  readonly busy?: boolean;
  readonly canRevert?: boolean;
  readonly changeBlockIndex: number;
  readonly changeKey: string;
  readonly hunkIndex: number;
  /** 精确标识触发等待态的按钮；busy 可仅表示全局禁用。 */
  readonly pendingAction?: "revert" | "stage" | "unstage";
  readonly state: "partial" | "staged" | "unstaged";
  /** 视图稳定 id 与 Git 语义 sectionKey 不同时使用。 */
  readonly targetSectionKey?: string;
}

/**
 * 账本槽态（stable-ledger）：
 * - estimate：未水合正文，稳定 id + 估高
 * - loaded：真 patch
 * - error / ready-notice：说明卡（无文本 patch）
 * 缺省 kind 时由 patch/stateNotice 推断（兼容旧调用）。
 */
export type PierDiffViewItemKind =
  | "estimate"
  | "loaded"
  | "error"
  | "ready-notice";

/**
 * 无行数提示时的默认估高行数。
 * 不宜为 0：冷启动 estimate→loaded 时 Δh 过大，首屏连锁水合会抖。
 * 取中等骨架（约半屏内 2–3 个文件），真高仍由 loaded 决定；校正走 Pierre 行锚。
 */
export const PIER_DIFF_DEFAULT_ESTIMATE_LINES = 16;
export const PIER_DIFF_MAX_ESTIMATE_BODY_LINES = 200;
/**
 * estimate 槽绘高（与 estimate-skeleton 金标准对齐）：
 *   header 32 + padY 16 + 5×12 条 + 4×8 gap ≈ 32+16+60+32 = 140 → 144
 * seed demand / 视口估条数用此常量，避免按 numstat 虚高。
 */
export const PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX = 144;

/**
 * 无 numstat 时按文件 status 给骨架行数（缩小 estimate→loaded 典型 Δh）。
 * index 日后带行数提示时应优先用提示，再回落到此。
 */
export function estimateLinesForFileStatus(
  status: PierDiffViewFileDisplay["status"]
): number {
  switch (status) {
    case "deleted":
      return 4;
    case "added":
      return 24;
    case "renamed":
      return 12;
    case "conflicted":
      return 28;
    default:
      return PIER_DIFF_DEFAULT_ESTIMATE_LINES;
  }
}

export interface PierDiffViewLineStats {
  readonly additions: number;
  readonly deletions: number;
}

export interface PierDiffViewItem {
  readonly cacheKey: string;
  readonly changeControls?: readonly PierDiffViewChangeControl[];
  /** estimate 估高行数（可选覆盖默认）。 */
  readonly estimateLines?: number;
  readonly fileDisplay?: PierDiffViewFileDisplay;
  readonly id: string;
  /** 显式槽态；缺省则按 patch/stateNotice 推断。 */
  readonly kind?: PierDiffViewItemKind;
  /**
   * index/numstat 行统计（首屏即可展示 +N −M，不必等 patch materialize）。
   * header 优先用已解析 hunk 统计，缺省再回落此值。
   */
  readonly lineStats?: PierDiffViewLineStats;
  /**
   * estimate / error / ready-notice：null
   * loaded：非 null 文本 patch
   */
  readonly patch: string | null;
  readonly stageControl?: PierDiffViewStageControl | null;
  /**
   * 非文本变更说明（binary / symlink / submodule…）或加载失败说明。
   * ready-notice / error：有 notice；estimate 通常无。
   */
  readonly stateNotice?: string;
}

export function resolvePierDiffViewItemKind(
  input: Pick<PierDiffViewItem, "kind" | "patch" | "stateNotice">
): PierDiffViewItemKind {
  if (input.kind !== undefined) {
    return input.kind;
  }
  if (input.stateNotice !== undefined && input.stateNotice.length > 0) {
    return "ready-notice";
  }
  if (input.patch === null) {
    // 旧路径 patch:null 无 notice 视为 estimate（不再当 loading 假槽）
    return "estimate";
  }
  return "loaded";
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

export type PierDiffCodeViewItem = CodeViewItem<PierHunkAnnotationMetadata>;

export interface ParsedItemCacheEntry {
  readonly cacheKey: string;
  readonly item: PierDiffCodeViewItem;
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
    const kind = resolvePierDiffViewItemKind(input);
    let fileDiff: FileDiffMetadata;
    if (kind === "loaded") {
      fileDiff = parsedFileDiff(input);
    } else if (kind === "estimate") {
      fileDiff = estimateFileDiff(input);
    } else {
      fileDiff = noticeFileDiff(input);
    }
    const version = (previous?.version ?? -1) + 1;
    const annotations =
      kind === "loaded"
        ? buildHunkActionAnnotations(fileDiff, input.changeControls)
        : undefined;
    // 无文本 diff / estimate：默认折叠；estimate 禁止展开成假行号文件体
    const emptyBody =
      kind === "ready-notice" ||
      kind === "error" ||
      kind === "estimate" ||
      (fileDiff.splitLineCount === 0 && fileDiff.unifiedLineCount === 0);
    const item: PierDiffCodeViewItem = {
      fileDiff,
      id: input.id,
      type: "diff",
      version,
      ...(emptyBody ? { collapsed: true } : {}),
      ...(annotations === undefined ? {} : { annotations }),
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
    // loaded 解析失败：notice 几何（0 行）+ error，禁止用 estimate 空行冒充正文
    const version = 0;
    const item: PierDiffCodeViewItem = {
      fileDiff: noticeFileDiff(
        input.fileDisplay
          ? input
          : {
              ...input,
              fileDisplay: {
                path: input.id,
                status: "modified",
              },
            }
      ),
      id: input.id,
      type: "diff",
      version,
      collapsed: true,
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
  items: PierDiffCodeViewItem[];
} {
  const items: PierDiffCodeViewItem[] = [];
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
  // processFile 对 new/deleted（缺一侧完整文件）会标 isPartial。
  // DiffsHub 靠 loadDiffFiles 再 hydrate；Pier Review 只用 patch 内嵌行文本、
  // 不接 loadDiffFiles。半水合路径在暂存切换/重绑时会触发
  // DiffHunksRenderer「deletionLine and additionLine are null」。
  // 若 patch 已自带完整 +/- 行缓冲，按非 partial 渲染。
  return applyFileDisplay(
    markSelfContainedPatchComplete(parsed),
    input.fileDisplay
  );
}

/**
 * patch 解析结果若已含 walk 所需的 addition/deletion 行文本，则去掉 isPartial。
 */
export function markSelfContainedPatchComplete(
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  if (!fileDiff.isPartial) {
    return fileDiff;
  }
  if (!patchLineBuffersCoverHunks(fileDiff)) {
    return fileDiff;
  }
  return { ...fileDiff, isPartial: false };
}

function patchLineBuffersCoverHunks(fileDiff: FileDiffMetadata): boolean {
  for (const hunk of fileDiff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        const endAdd = content.additionLineIndex + content.lines;
        const endDel = content.deletionLineIndex + content.lines;
        if (
          endAdd > fileDiff.additionLines.length ||
          endDel > fileDiff.deletionLines.length
        ) {
          return false;
        }
        continue;
      }
      if (content.type === "change") {
        if (
          content.additions > 0 &&
          content.additionLineIndex + content.additions >
            fileDiff.additionLines.length
        ) {
          return false;
        }
        if (
          content.deletions > 0 &&
          content.deletionLineIndex + content.deletions >
            fileDiff.deletionLines.length
        ) {
          return false;
        }
      }
    }
  }
  return fileDiff.hunks.length > 0;
}

/**
 * estimate 槽：只占 header 几何，**0 正文行**。
 *
 * 禁止灌 1..N 行号 / context /「unmodified lines」假文件体——用户会当成渲染坏了。
 * 列表估高仍用 input.estimateLines / 外层 CSS min-height；水合后以真 patch 为准。
 * **禁止** isPartial（见 DiffHunks null 行崩溃）。
 */
export function estimateFileDiff(input: PierDiffViewItem): FileDiffMetadata {
  const display = input.fileDisplay;
  if (!display) {
    throw new Error(`Pierre estimate is missing file display: ${input.id}`);
  }
  return {
    additionLines: [],
    cacheKey: input.cacheKey,
    deletionLines: [],
    hunks: [],
    isPartial: false,
    name: display.path,
    ...(display.previousPath === undefined
      ? {}
      : { prevName: display.previousPath }),
    splitLineCount: 0,
    type: "change",
    unifiedLineCount: 0,
  };
}

/** 是否为 estimate 占位 FileDiff（0 正文、cacheKey 前缀）。 */
export function isEstimateCodeViewItem(
  item: PierDiffCodeViewItem | undefined
): boolean {
  if (item?.type !== "diff") {
    return false;
  }
  return (
    typeof item.fileDiff.cacheKey === "string" &&
    item.fileDiff.cacheKey.startsWith("estimate:")
  );
}

/** error / ready-notice：仅 header 几何（0 正文行），presentation 靠 stateNotice。 */
function noticeFileDiff(input: PierDiffViewItem): FileDiffMetadata {
  const display = input.fileDisplay;
  if (!display) {
    throw new Error(`Pierre notice item is missing file display: ${input.id}`);
  }
  return {
    additionLines: [],
    cacheKey: input.cacheKey,
    deletionLines: [],
    hunks: [],
    isPartial: false,
    name: display.path,
    ...(display.previousPath === undefined
      ? {}
      : { prevName: display.previousPath }),
    splitLineCount: 0,
    type: fileDisplayType(display.status),
    unifiedLineCount: 0,
  };
}

/** @deprecated 使用 estimateFileDiff；保留别名避免外部误引用旧名。 */
export function placeholderFileDiff(input: PierDiffViewItem): FileDiffMetadata {
  return estimateFileDiff(input);
}
