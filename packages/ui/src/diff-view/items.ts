import type { FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";
import { parsePatchFileDiff } from "./file-diff/from-patch.ts";
import { estimateFileDiff, noticeFileDiff } from "./file-diff/placeholders.ts";
import { buildHunkActionAnnotations } from "./hunk-annotations.ts";
import { buildImageDiffAnnotation } from "./image-diff/annotation.ts";
import { createImageDiffFileDiff } from "./image-diff/file-diff.ts";
import type { PierDiffViewItemImageDiff } from "./image-diff/types.ts";
import {
  buildDriftAnnotations,
  buildInlineThreadAnnotations,
} from "./review/annotation-anchors.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";
import { itemCacheKeyOf } from "./review/drift-cache-key.ts";
import { buildUnresolvedConflictAnnotation } from "./unresolved-conflict/annotation.ts";
import { createUnresolvedConflictFileDiff } from "./unresolved-conflict/file-diff.ts";

export {
  estimateFileDiff,
  isEstimateCodeViewItem,
  placeholderFileDiff,
} from "./file-diff/placeholders.ts";
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
  | "ready-notice"
  /** Merge conflict body; CodeView file chrome + UnresolvedFile annotation. */
  | "conflict"
  /** Raster image comparison; render via image-diff annotation, not text hunks. */
  | "image";

import type { PierDiffViewConflictBody } from "./types.ts";

export type {
  PierDiffViewConflictBody,
  PierDiffViewConflictPresentation,
  PierDiffViewConflictXy,
} from "./types.ts";

export interface PierDiffViewLineStats {
  readonly additions: number;
  readonly deletions: number;
}

/**
 * diff 行内评论线程的通用投影（packages/ui 不耦合 host 评论契约）。
 *
 * git 插件把 CommentThreadSnapshot.threads 映射成此类型后注入
 * PierDiffViewItem.reviewComments：target.side "old" → "deletions"，
 * "new" → "additions"；line 直传（1-based 文件行号）。gutter 渲染按
 * (side, line) 查询匹配线程。v1 瘦身：每锚点一条评论，无 state/count。
 */
export interface PierDiffReviewCommentThread {
  /**
   * 创建时的文件 blob OID（可选）。宿主投影用其与当前 patch index 比对；
   * 不一致则不得原位展示（防空挂）。UI 层可不消费。
   */
  readonly blobOid?: string;
  readonly line: number;
  readonly side: "additions" | "deletions";
  readonly threadId: string;
}

/**
 * 文件级折叠区评论线程（漂移 + git-file 文件级），packages/ui 不耦合 host 契约。
 *
 * - 行内评论漂移：原 anchor `line`/`side` 保留（显示「第 X 行评论已无法定位」）；
 *   diff-view 渲染时按 (side, line) 找不到行 → 业务层判漂移后从 reviewComments 移入。
 * - git-file 文件级评论：无 anchor（line/side 缺省），直接显示为文件级线程。
 * 折叠区在文件 header 下渲染（对齐 GitHub outdated 折叠在原位 = 文件）。
 * v1 瘦身：无 state/count。
 */
export interface PierDiffReviewDriftThread {
  /** 行内评论漂移后的原 anchor 行号；git-file 文件级评论为 undefined */
  readonly line?: number;
  /** 行内评论漂移后的原 anchor side；git-file 文件级评论为 undefined */
  readonly side?: "additions" | "deletions";
  readonly threadId: string;
}

export interface PierDiffViewItem {
  readonly cacheKey: string;
  readonly changeControls?: readonly PierDiffViewChangeControl[];
  /** Conflict body for the CodeView file-level annotation. */
  readonly conflict?: PierDiffViewConflictBody;
  /**
   * Full old/new text for Pierre expand of collapsed unmodified lines.
   * Omit with a hunk-only patch so `isPartial` stays true.
   */
  readonly diffFiles?: {
    readonly newContents: string;
    readonly oldContents: string;
  };
  /** File-level / drifted threads under the file header. */
  readonly driftComments?: readonly PierDiffReviewDriftThread[];
  readonly fileDisplay?: PierDiffViewFileDisplay;
  readonly id: string;
  /** Raster sides for `kind: "image"`; locators are resolved by the host. */
  readonly imageDiff?: PierDiffViewItemImageDiff;
  /** Explicit slot kind; else inferred from patch/stateNotice. */
  readonly kind?: PierDiffViewItemKind;
  /** index/numstat stats for header before patch hydrate. */
  readonly lineStats?: PierDiffViewLineStats;
  /** loaded: patch text; estimate/error/ready-notice/conflict: null */
  readonly patch: string | null;
  /** Inline review threads for gutter (side, line). */
  readonly reviewComments?: readonly PierDiffReviewCommentThread[];
  readonly stageControl?: PierDiffViewStageControl | null;
  /** Non-text or load-failure notice for ready-notice / error. */
  readonly stateNotice?: string;
}

export function resolvePierDiffViewItemKind(
  input: Pick<PierDiffViewItem, "kind" | "patch" | "stateNotice" | "conflict">
): PierDiffViewItemKind {
  if (input.kind !== undefined) {
    return input.kind;
  }
  if (input.conflict !== undefined) {
    return "conflict";
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

export type PierDiffCodeViewItem = CodeViewItem<PierDiffAnnotationMetadata>;

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
    if (kind === "image") {
      if (!input.fileDisplay || input.imageDiff === undefined) {
        throw new Error(`Pierre image diff is missing sides: ${input.id}`);
      }
      fileDiff = createImageDiffFileDiff({
        cacheKey: input.cacheKey,
        name: input.fileDisplay.path,
        type: fileDisplayType(input.fileDisplay.status),
        ...(input.fileDisplay.previousPath === undefined
          ? {}
          : { prevName: input.fileDisplay.previousPath }),
      });
    } else if (kind === "conflict") {
      const estimated =
        input.conflict?.contentsDigest.startsWith("estimate:") === true;
      if (estimated || !input.fileDisplay) {
        fileDiff = estimateFileDiff(input);
      } else {
        fileDiff = createUnresolvedConflictFileDiff({
          cacheKey: input.cacheKey,
          name: input.fileDisplay.path,
          type: fileDisplayType(input.fileDisplay.status),
          ...(input.fileDisplay.previousPath === undefined
            ? {}
            : { prevName: input.fileDisplay.previousPath }),
        });
      }
    } else if (kind === "loaded") {
      fileDiff = applyFileDisplay(
        parsePatchFileDiff({
          cacheKey: input.cacheKey,
          id: input.id,
          patch: input.patch,
          ...(input.diffFiles === undefined
            ? {}
            : { diffFiles: input.diffFiles }),
          ...(input.fileDisplay === undefined
            ? {}
            : { fileName: input.fileDisplay.path }),
        }),
        input.fileDisplay
      );
    } else if (kind === "estimate") {
      fileDiff = estimateFileDiff(input);
    } else {
      // ready-notice / error：CodeView 只作占位。
      fileDiff = noticeFileDiff(input);
    }
    const version = (previous?.version ?? -1) + 1;
    const hunkAnnotations =
      kind === "loaded"
        ? buildHunkActionAnnotations(fileDiff, input.changeControls)
        : undefined;
    const imageAnnotations =
      kind === "image" && input.imageDiff !== undefined
        ? buildImageDiffAnnotation(fileDiff.type, input.imageDiff)
        : undefined;
    const conflictEstimate =
      kind === "conflict" &&
      (input.conflict?.contentsDigest.startsWith("estimate:") ?? true);
    const conflictAnnotations =
      kind === "conflict" &&
      input.conflict !== undefined &&
      input.fileDisplay !== undefined &&
      !conflictEstimate
        ? buildUnresolvedConflictAnnotation(fileDiff.type, {
            conflict: input.conflict,
            path: input.fileDisplay.path,
            ...(input.stateNotice === undefined
              ? {}
              : { stateNotice: input.stateNotice }),
          })
        : undefined;
    // 文件级 drift 折叠区 annotation（lineNumber: 0，首个 hunk 前渲染）。
    const driftAnnotations = buildDriftAnnotations(
      input.driftComments,
      fileDiff.type
    );
    // 行内评论卡 annotation（每个线程一条 per-line；无折叠 badge 态）。
    const inlineThreadAnnotations = buildInlineThreadAnnotations(
      input.reviewComments
    );
    const annotations =
      hunkAnnotations === undefined &&
      imageAnnotations === undefined &&
      conflictAnnotations === undefined &&
      driftAnnotations === undefined &&
      inlineThreadAnnotations === undefined
        ? undefined
        : [
            ...(hunkAnnotations ?? []),
            ...(imageAnnotations ?? []),
            ...(conflictAnnotations ?? []),
            ...(driftAnnotations ?? []),
            ...(inlineThreadAnnotations ?? []),
          ];
    // 无文本 diff / estimate：默认折叠；estimate 禁止展开成假行号文件体
    const emptyBody =
      kind === "ready-notice" ||
      kind === "error" ||
      kind === "estimate" ||
      conflictEstimate ||
      (kind !== "image" &&
        kind !== "conflict" &&
        fileDiff.splitLineCount === 0 &&
        fileDiff.unifiedLineCount === 0);
    const item: PierDiffCodeViewItem = {
      fileDiff,
      id: input.id,
      type: "diff",
      version,
      ...(emptyBody ? { collapsed: true } : {}),
      ...(annotations === undefined ? {} : { annotations }),
    };
    return {
      entry: { cacheKey: itemCacheKeyOf(input), item, version },
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
      entry: { cacheKey: itemCacheKeyOf(input), item, version },
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
    if (previous?.cacheKey === itemCacheKeyOf(input)) {
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
