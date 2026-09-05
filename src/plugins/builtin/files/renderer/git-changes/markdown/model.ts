import { diffArrays } from "diff";
import type { MarkdownBlock, MarkdownIrDocument } from "../../markdown/ir.ts";
import type { FileChangeRange } from "../types.ts";
import {
  changedMarkdownAttributes,
  type MarkdownAttributeChange,
} from "./attributes.ts";
import { diffMarkdownInlines } from "./inlines.ts";
import { annotateMarkdownLinks } from "./links.ts";
import {
  markdownContentKey,
  markdownVisibleContentKey,
  visitMarkdownNodes,
} from "./nodes.ts";
import { type ChangedBlocks, selectChangedBlocks } from "./selection.ts";

export interface MarkdownDiffBlock {
  block: MarkdownBlock;
  kind: "added" | "deleted" | "modified";
  side: "before" | "after";
}
export interface MarkdownDiffModel {
  attributes: MarkdownAttributeChange[];
  blocks: MarkdownDiffBlock[];
  hasHistoricalImages: boolean;
  hasHtml: boolean;
  requiresSource: boolean;
}

function mergeProse(
  before: MarkdownBlock,
  after: MarkdownBlock
): MarkdownBlock | null {
  if (before.kind === "paragraph" && after.kind === "paragraph") {
    const children = diffMarkdownInlines(before.children, after.children);
    return children ? { ...after, children } : null;
  }
  if (
    before.kind === "heading" &&
    after.kind === "heading" &&
    before.depth === after.depth
  ) {
    const children = diffMarkdownInlines(before.children, after.children);
    return children ? { ...after, children } : null;
  }
  return null;
}

/** Complete-document alignment keeps reference resolution and structural context. */
export function buildMarkdownDiff({
  before,
  after,
  range,
}: {
  before: MarkdownIrDocument;
  after: MarkdownIrDocument;
  range: FileChangeRange;
}): MarkdownDiffModel {
  const keys = new Map<MarkdownBlock, string>();
  for (const block of [...before.blocks, ...after.blocks])
    keys.set(block, markdownContentKey(block));
  const parts = diffArrays(before.blocks, after.blocks, {
    comparator: (a, b) => keys.get(a) === keys.get(b),
    maxEditLength: 2000,
    timeout: 50,
  });
  if (!parts) throw new Error("markdown-diff-too-large");
  const groups: ChangedBlocks[] = [];
  let group: ChangedBlocks | null = null;
  for (const part of parts) {
    if (!(part.added || part.removed)) {
      group = null;
      continue;
    }
    if (!group) {
      group = { before: [], after: [] };
      groups.push(group);
    }
    (part.removed ? group.before : group.after).push(...part.value);
  }
  const selected = selectChangedBlocks(groups, range);
  // Bound the DOM payload as well as alignment work; large blocks stay complete
  // in the virtualized Source view instead of silently truncating the preview.
  let size = 0;
  let count = 0;
  for (const item of selected) {
    for (const block of [...item.before, ...item.after]) {
      size += keys.get(block)?.length ?? 0;
      count++;
      if (size > 512_000 || count > 200)
        throw new Error("markdown-diff-too-large");
    }
  }
  const result: MarkdownDiffModel = {
    blocks: [],
    attributes: [],
    hasHtml: false,
    hasHistoricalImages: false,
    requiresSource: false,
  };
  for (const item of selected) {
    const afterBlocks = annotateMarkdownLinks(item.before, item.after);
    result.attributes.push(
      ...changedMarkdownAttributes(item.before, item.after)
    );
    visitMarkdownNodes([...item.before, ...item.after], (node) => {
      if (node.kind === "html") result.hasHtml = true;
    });
    visitMarkdownNodes(item.before, (node) => {
      if (node.kind === "image") result.hasHistoricalImages = true;
    });
    for (
      let index = 0;
      index < Math.max(item.before.length, item.after.length);
      index++
    ) {
      const oldBlock = item.before[index];
      const newBlock = afterBlocks[index];
      if (
        oldBlock &&
        newBlock &&
        markdownContentKey(oldBlock) !== markdownContentKey(newBlock) &&
        markdownVisibleContentKey(oldBlock) ===
          markdownVisibleContentKey(newBlock)
      )
        result.requiresSource = true;
      const merged =
        oldBlock && newBlock ? mergeProse(oldBlock, newBlock) : null;
      if (merged)
        result.blocks.push({ block: merged, kind: "modified", side: "after" });
      else {
        if (oldBlock)
          result.blocks.push({
            block: oldBlock,
            kind: "deleted",
            side: "before",
          });
        if (newBlock)
          result.blocks.push({ block: newBlock, kind: "added", side: "after" });
      }
    }
  }
  if (result.blocks.length > 200) throw new Error("markdown-diff-too-large");
  result.attributes = [
    ...new Map(
      result.attributes.map((attribute) => [
        JSON.stringify(attribute),
        attribute,
      ])
    ).values(),
  ];
  return result;
}
