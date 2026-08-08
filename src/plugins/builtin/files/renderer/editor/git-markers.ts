import type { GitDiffFilePatch } from "@shared/contracts/git.ts";

export type GitGutterKind = "added" | "modified" | "deleted";

export interface GitGutterLineMarker {
  /** 该标记覆盖的行数：deleted = 被删行数，added/modified = 1。 */
  count: number;
  kind: GitGutterKind;
}

/**
 * 可点击命中的变更区间（对齐 hunk 内一段纯 add / 纯 del / 替换块）。
 * 仅行号跨度；不保留旧/新全文（点击跳 Changes，不再做编辑器内 peek）。
 */
export interface GitGutterChangeRange {
  /** 稳定 id：`${hunkIndex}:${blockIndex}` */
  id: string;
  kind: GitGutterKind;
  /**
   * 磁盘新文件侧 1-based 行号闭区间（可点击命中）。
   * deleted：锚在删除后的下一 new 行（或末行 / newStart），from===to。
   */
  newLineFrom: number;
  newLineTo: number;
}

export interface GitGutterModel {
  readonly markers: ReadonlyMap<number, GitGutterLineMarker>;
  readonly ranges: readonly GitGutterChangeRange[];
}

export const EMPTY_GIT_GUTTER_MODEL: GitGutterModel = {
  markers: new Map(),
  ranges: [],
};

const PRIORITY: Record<GitGutterKind, number> = {
  modified: 3,
  added: 2,
  deleted: 1,
};

function setMarker(
  markers: Map<number, GitGutterLineMarker>,
  line: number,
  marker: GitGutterLineMarker
): void {
  const existing = markers.get(line);
  if (!existing || PRIORITY[marker.kind] > PRIORITY[existing.kind]) {
    markers.set(line, marker);
  }
}

/**
 * 行文本 LCS 布尔掩码：oldMask[i]/newMask[j] 为 true 表示该行在 LCS 中（内容未改）。
 * Hunk 规模通常很小，O(n*m) 可接受。
 */
function lineLcsMasks(
  oldTexts: readonly string[],
  newTexts: readonly string[]
): { readonly oldMask: boolean[]; readonly newMask: boolean[] } {
  const n = oldTexts.length;
  const m = newTexts.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0)
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (oldTexts[i] === newTexts[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }
  const oldMask = Array.from({ length: n }, () => false);
  const newMask = Array.from({ length: m }, () => false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTexts[i] === newTexts[j]) {
      oldMask[i] = true;
      newMask[j] = true;
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { newMask, oldMask };
}

function pureDeletionAnchor(options: {
  readonly hasFollowingHunkLine: boolean;
  readonly hunkNewStart: number;
  readonly lastNewLine: number;
  readonly newLine: number;
  readonly sawNewLine: boolean;
}): number {
  if (options.hasFollowingHunkLine) {
    return options.newLine;
  }
  if (options.sawNewLine) {
    return options.lastNewLine;
  }
  return options.hunkNewStart;
}

function applyPureDeletion(
  markers: Map<number, GitGutterLineMarker>,
  ranges: GitGutterChangeRange[],
  pureDel: number,
  rangeId: string,
  options: {
    readonly hasFollowingHunkLine: boolean;
    readonly hunkNewStart: number;
    readonly lastNewLine: number;
    readonly newLine: number;
    readonly sawNewLine: boolean;
  }
): void {
  if (pureDel <= 0) {
    return;
  }
  const anchor = pureDeletionAnchor(options);
  const existing = markers.get(anchor);
  if (!existing || PRIORITY.deleted >= PRIORITY[existing.kind]) {
    markers.set(anchor, { count: pureDel, kind: "deleted" });
  }
  // 锚行已被更高优先级占用时仍登记 range，点击该行优先 modified/added（resolve 用优先级）。
  ranges.push({
    id: rangeId,
    kind: "deleted",
    newLineFrom: anchor,
    newLineTo: anchor,
  });
}

/**
 * 把单个 GitDiffFilePatch 映射成 gutter markers + 可点击 change ranges。
 *
 * 终态规则（对齐 VS Code SCM line range mapping + 行内容 LCS）：
 * 1. 纯 add 块 → 每行 `added`；整块一条 range。
 * 2. 纯 del 块 → `deleted` 锚在删除后的下一 new 行（或末行 / newStart），count=被删行数。
 * 3. 非空 old + 非空 new 的替换块：LCS 相等行不标记；其余 new 行 `modified`；range 覆盖整块 new 行。
 * 4. 同行多规则优先级：modified > added > deleted。
 * 5. patch 为 null 或 binary：空 model。
 */
export function buildGitGutterModel(
  patch: GitDiffFilePatch | null
): GitGutterModel {
  const markers = new Map<number, GitGutterLineMarker>();
  const ranges: GitGutterChangeRange[] = [];
  if (!patch || patch.binary) {
    return { markers, ranges };
  }
  patch.hunks.forEach((hunk, hunkIndex) => {
    const lines = hunk.lines;
    let newLine = hunk.newStart;
    let lastNewLine = hunk.newStart;
    let sawNewLine = false;
    let i = 0;
    let blockIndex = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        break;
      }
      if (line.kind === "context") {
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
        i += 1;
        continue;
      }
      if (line.kind === "add") {
        let j = i;
        while (lines[j]?.kind === "add") j += 1;
        const addCount = j - i;
        const from = newLine;
        for (let k = 0; k < addCount; k += 1) {
          setMarker(markers, newLine, { count: 1, kind: "added" });
          lastNewLine = newLine;
          sawNewLine = true;
          newLine += 1;
        }
        ranges.push({
          id: `${hunkIndex}:${blockIndex}`,
          kind: "added",
          newLineFrom: from,
          newLineTo: from + addCount - 1,
        });
        blockIndex += 1;
        i = j;
        continue;
      }
      // del 块：与紧随 add 块组成一次 change range（VS Code line mapping）。
      let j = i;
      while (lines[j]?.kind === "del") j += 1;
      const delLines = lines.slice(i, j);
      const delCount = delLines.length;
      let k = j;
      while (lines[k]?.kind === "add") k += 1;
      const addLines = lines.slice(j, k);
      const addCount = addLines.length;
      const rangeId = `${hunkIndex}:${blockIndex}`;
      blockIndex += 1;

      if (addCount === 0) {
        applyPureDeletion(markers, ranges, delCount, rangeId, {
          hasFollowingHunkLine: k < lines.length,
          hunkNewStart: hunk.newStart,
          lastNewLine,
          newLine,
          sawNewLine,
        });
        i = k;
        continue;
      }

      // 替换 range：LCS 去掉未改动行，其余 new 行全部 modified。
      const oldTexts = delLines.map((entry) => entry.text);
      const newTexts = addLines.map((entry) => entry.text);
      const { newMask } = lineLcsMasks(oldTexts, newTexts);
      const blockNewFrom = newLine;
      for (let offset = 0; offset < addCount; offset += 1) {
        if (!newMask[offset]) {
          setMarker(markers, newLine, { count: 1, kind: "modified" });
        }
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
      }
      const blockNewTo = newLine - 1;
      // 仅当至少有一行被标 modified 时登记 range（全 LCS 相等则无 gutter）。
      const hasModified = newMask.some((kept) => !kept);
      if (hasModified) {
        ranges.push({
          id: rangeId,
          kind: "modified",
          newLineFrom: blockNewFrom,
          newLineTo: blockNewTo,
        });
      }
      i = k;
    }
  });
  return { markers, ranges };
}

/**
 * 把单个 GitDiffFilePatch 的 hunks 映射成「磁盘新文件侧 1-based 行号 → gutter 标记」。
 * 兼容薄封装：与 {@link buildGitGutterModel} 同源。
 */
export function markersFromDiffPatch(
  patch: GitDiffFilePatch | null
): ReadonlyMap<number, GitGutterLineMarker> {
  return buildGitGutterModel(patch).markers;
}

/**
 * 行号命中可 peek 的 change range。同行多 range 时按 kind 优先级取高者。
 */
export function resolveRangeAtLine(
  ranges: readonly GitGutterChangeRange[],
  line: number
): GitGutterChangeRange | null {
  if (line < 1 || ranges.length === 0) {
    return null;
  }
  let best: GitGutterChangeRange | null = null;
  for (const range of ranges) {
    if (line < range.newLineFrom || line > range.newLineTo) {
      continue;
    }
    if (!best || PRIORITY[range.kind] > PRIORITY[best.kind]) {
      best = range;
    }
  }
  return best;
}
