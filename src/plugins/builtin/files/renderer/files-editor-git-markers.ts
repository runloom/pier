import type { GitDiffFilePatch } from "@shared/contracts/git.ts";

export type GitGutterKind = "added" | "modified" | "deleted";

export interface GitGutterLineMarker {
  /** 该标记覆盖的行数：deleted = 被删行数，added/modified = 1。 */
  count: number;
  kind: GitGutterKind;
}

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

function isKind(
  lines: readonly { kind: string }[],
  index: number,
  kind: "add" | "del"
): boolean {
  return lines[index]?.kind === kind;
}

/**
 * 把单个 GitDiffFilePatch 的 hunks 映射成「磁盘新文件侧 1-based 行号 → gutter 标记」。
 *
 * 规则：
 * - 连续 del 后接连续 add：前 min(del,add) 个 add 行标 modified，余下 add 标 added。
 * - 纯 del 溢出（pureDel 行）：锚在删除块结束后的下一行 new 位置（删除发生在该行上方），
 *   count = pureDel；若删除直达 hunk 末尾无后续 new 行，锚在最后一个出现过的 new 行；
 *   若整 hunk 无任何 new 侧行，锚在 hunk.newStart。渲染时红条按 count 向上覆盖被删区间。
 * - 同行多规则优先级：modified > added > deleted。
 * - patch 为 null 或 binary：返回空 Map。
 *
 * 注：del+add 配对是否视为「修改」是 unified diff 的启发式近似，非精确逐行替换。
 */
export function markersFromDiffPatch(
  patch: GitDiffFilePatch | null
): ReadonlyMap<number, GitGutterLineMarker> {
  const markers = new Map<number, GitGutterLineMarker>();
  if (!patch || patch.binary) {
    return markers;
  }
  for (const hunk of patch.hunks) {
    const lines = hunk.lines;
    let newLine = hunk.newStart;
    let lastNewLine = hunk.newStart;
    let sawNewLine = false;
    let i = 0;
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
        while (isKind(lines, j, "add")) j += 1;
        const addCount = j - i;
        for (let k = 0; k < addCount; k += 1) {
          setMarker(markers, newLine, { count: 1, kind: "added" });
          lastNewLine = newLine;
          sawNewLine = true;
          newLine += 1;
        }
        i = j;
        continue;
      }
      // del 块：尝试与紧随其后的 add 块配对
      let j = i;
      while (isKind(lines, j, "del")) j += 1;
      const delCount = j - i;
      let addCount = 0;
      let k = j;
      while (isKind(lines, k, "add")) {
        addCount += 1;
        k += 1;
      }
      const modifiedCount = Math.min(delCount, addCount);
      for (let m = 0; m < modifiedCount; m += 1) {
        setMarker(markers, newLine, { count: 1, kind: "modified" });
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
      }
      const addedRemainder = addCount - modifiedCount;
      for (let m = 0; m < addedRemainder; m += 1) {
        setMarker(markers, newLine, { count: 1, kind: "added" });
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
      }
      const pureDel = delCount - modifiedCount;
      if (pureDel > 0) {
        let anchor: number;
        if (k < lines.length) {
          // 后续还有行：锚在 newLine（删除发生在该行上方），newLine 不前进
          anchor = newLine;
        } else if (sawNewLine) {
          anchor = lastNewLine;
        } else {
          anchor = hunk.newStart;
        }
        const existing = markers.get(anchor);
        // 若锚行已有 added/modified 标记，删除标记不应覆盖更高优先级；
        // 此时把删除计数并入同锚行的 deleted（优先级低，仅当锚行无更高标记时生效）。
        if (!existing || PRIORITY.deleted >= PRIORITY[existing.kind]) {
          markers.set(anchor, { count: pureDel, kind: "deleted" });
        }
      }
      i = k;
    }
  }
  return markers;
}
