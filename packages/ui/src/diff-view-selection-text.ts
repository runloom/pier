import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";

type SelectionSide = "additions" | "deletions";

function stripLineEnding(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, "");
}

function lineAt(
  fileDiff: FileDiffMetadata,
  lineNumber: number,
  side: SelectionSide
): string | undefined {
  const lines =
    side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
  if (!fileDiff.isPartial) {
    return lines[lineNumber - 1];
  }
  for (const hunk of fileDiff.hunks) {
    const start =
      side === "deletions" ? hunk.deletionStart : hunk.additionStart;
    const count =
      side === "deletions" ? hunk.deletionCount : hunk.additionCount;
    const baseIndex =
      side === "deletions" ? hunk.deletionLineIndex : hunk.additionLineIndex;
    if (lineNumber >= start && lineNumber < start + count) {
      return lines[baseIndex + (lineNumber - start)];
    }
  }
  return;
}

/**
 * 把 Pierre 行选区映射为可复制文本。
 * split 同侧连续行整段复制；跨侧只取两端行，避免拼出错误内容。
 */
export function selectedLinesTextFromFileDiff(
  fileDiff: FileDiffMetadata,
  range: SelectedLineRange
): string {
  const startSide: SelectionSide = range.side ?? "additions";
  const endSide: SelectionSide = range.endSide ?? range.side ?? "additions";
  if (startSide === endSide) {
    const from = Math.min(range.start, range.end);
    const to = Math.max(range.start, range.end);
    const out: string[] = [];
    for (let lineNumber = from; lineNumber <= to; lineNumber += 1) {
      const line = lineAt(fileDiff, lineNumber, startSide);
      if (line !== undefined) {
        out.push(stripLineEnding(line));
      }
    }
    return out.join("\n");
  }
  const startLine = lineAt(fileDiff, range.start, startSide);
  const endLine = lineAt(fileDiff, range.end, endSide);
  return [startLine, endLine]
    .filter((line): line is string => line !== undefined)
    .map(stripLineEnding)
    .join("\n");
}

export function selectedLinesTextFromCodeViewItem(
  item: CodeViewItem | undefined,
  range: SelectedLineRange
): string {
  if (!item) {
    return "";
  }
  if (item.type === "diff") {
    return selectedLinesTextFromFileDiff(item.fileDiff, range);
  }
  if (item.type === "file") {
    return selectedLinesTextFromFileContents(item.file.contents, range);
  }
  return "";
}

function selectedLinesTextFromFileContents(
  contents: string,
  range: SelectedLineRange
): string {
  const lines = contents.split("\n");
  // 末尾空行来自 split 尾随换行，不计入可选行号。
  const lineCount =
    lines.length > 0 && lines.at(-1) === "" ? lines.length - 1 : lines.length;
  if (lineCount <= 0) {
    return "";
  }
  const from = Math.min(range.start, range.end);
  const to = Math.max(range.start, range.end);
  const out: string[] = [];
  for (let lineNumber = from; lineNumber <= to; lineNumber += 1) {
    if (lineNumber < 1 || lineNumber > lineCount) {
      continue;
    }
    out.push(stripLineEnding(lines[lineNumber - 1] ?? ""));
  }
  return out.join("\n");
}

/** 当前 item 可全选的行范围；空文件返回 null。 */
export function fullSelectionRangeForCodeViewItem(
  item: CodeViewItem | undefined
): SelectedLineRange | null {
  if (!item) {
    return null;
  }
  if (item.type === "diff") {
    const fileDiff = item.fileDiff;
    const additionBounds = sideBounds(fileDiff, "additions");
    if (additionBounds) {
      return {
        end: additionBounds.end,
        side: "additions",
        start: additionBounds.start,
      };
    }
    const deletionBounds = sideBounds(fileDiff, "deletions");
    if (deletionBounds) {
      return {
        end: deletionBounds.end,
        side: "deletions",
        start: deletionBounds.start,
      };
    }
    return null;
  }
  if (item.type === "file") {
    const lines = item.file.contents.split("\n");
    const lineCount =
      lines.length > 0 && lines.at(-1) === "" ? lines.length - 1 : lines.length;
    if (lineCount <= 0) {
      return null;
    }
    return { end: lineCount, start: 1 };
  }
  return null;
}

function sideBounds(
  fileDiff: FileDiffMetadata,
  side: SelectionSide
): { end: number; start: number } | null {
  // Pierre InteractionManager 只能画一段连续 range。
  // 多 hunk 时只取第一个有内容的 hunk，避免跨空隙高亮未选中的上下文行；
  // 复制文本仍由 selectedLinesTextFromFileDiff 按实际 hunk 行过滤。
  if (fileDiff.hunks.length > 0) {
    for (const hunk of fileDiff.hunks) {
      const hunkStart =
        side === "deletions" ? hunk.deletionStart : hunk.additionStart;
      const hunkCount =
        side === "deletions" ? hunk.deletionCount : hunk.additionCount;
      if (hunkCount <= 0) {
        continue;
      }
      return { end: hunkStart + hunkCount - 1, start: hunkStart };
    }
  }
  const lines =
    side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
  if (lines.length <= 0) {
    return null;
  }
  return { end: lines.length, start: 1 };
}
