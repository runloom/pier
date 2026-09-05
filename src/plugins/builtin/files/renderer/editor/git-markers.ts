export type GitGutterKind = "added" | "modified" | "deleted";

export interface GitGutterLineMarker {
  /** 同一可视行上的修改数。 */
  count: number;
  kind: GitGutterKind;
}

/**
 * 可点击命中的变更区间（对齐 hunk 内一段纯 add / 纯 del / 替换块）。
 * 完整文本和两侧行号由 git-changes 的不可变快照保存。
 */
export interface GitGutterChangeRange {
  /** 快照内稳定且唯一的 id。 */
  id: string;
  kind: GitGutterKind;
  /**
   * 当前文档侧 1-based 行号闭区间（可点击命中）。
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

/** Resolve overlapping markers deterministically; peek navigation retains every range. */
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
