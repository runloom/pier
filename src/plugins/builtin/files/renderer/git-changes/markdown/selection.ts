import type { MarkdownBlock, MarkdownSourceRange } from "../../markdown/ir.ts";
import type { FileChangeRange } from "../types.ts";
import { visitMarkdownNodes } from "./nodes.ts";

export interface ChangedBlocks {
  after: MarkdownBlock[];
  before: MarkdownBlock[];
}

function overlaps(
  range: MarkdownSourceRange,
  from: number,
  count: number
): boolean {
  return count > 0 && range.startLine < from + count && range.endLine >= from;
}

function touched(block: MarkdownBlock, from: number, count: number): boolean {
  let matched = overlaps(block.range, from, count);
  visitMarkdownNodes([block], (node) => {
    if (
      (node.kind === "link" || node.kind === "image") &&
      node.definitionRange &&
      overlaps(node.definitionRange, from, count)
    )
      matched = true;
  });
  return matched;
}

/** Complete counterpart blocks retain context for insertions within a list,
 * paragraph or table, without pulling adjacent independent edits into the peek. */
function counterparts(
  selected: ReadonlySet<MarkdownBlock>,
  candidates: MarkdownBlock[],
  from: number,
  count: number,
  to: number,
  toCount: number
): MarkdownBlock[] {
  const result = new Set<MarkdownBlock>();
  for (const block of selected) {
    const start =
      block.range.startLine < from ? block.range.startLine + to - from : to;
    const end =
      block.range.endLine >= from + count
        ? block.range.endLine + to - from + toCount - count
        : to + toCount - 1;
    for (const candidate of candidates)
      if (overlaps(candidate.range, start, end - start + 1))
        result.add(candidate);
  }
  return [...result];
}

export function selectChangedBlocks(
  groups: ChangedBlocks[],
  range: FileChangeRange
): ChangedBlocks[] {
  return groups.flatMap((group) => {
    const before = new Set(
      group.before.filter((block) =>
        touched(block, range.oldLineFrom, range.oldLineCount)
      )
    );
    const after = new Set(
      group.after.filter((block) =>
        touched(block, range.newLineFrom, range.newLineCount)
      )
    );
    const oldCounterparts = counterparts(
      after,
      group.before,
      range.newLineFrom,
      range.newLineCount,
      range.oldLineFrom,
      range.oldLineCount
    );
    const newCounterparts = counterparts(
      before,
      group.after,
      range.oldLineFrom,
      range.oldLineCount,
      range.newLineFrom,
      range.newLineCount
    );
    for (const block of oldCounterparts) before.add(block);
    for (const block of newCounterparts) after.add(block);
    if (!(before.size || after.size)) return [];
    return [
      {
        before: group.before.filter((block) => before.has(block)),
        after: group.after.filter((block) => after.has(block)),
      },
    ];
  });
}
