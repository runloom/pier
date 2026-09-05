import type { MarkdownBlock, MarkdownInline } from "../../markdown/ir.ts";
import { visitMarkdownNodes } from "./nodes.ts";
import { alignMarkdownResources } from "./resources.ts";

type Link = Extract<MarkdownInline, { kind: "link" }>;

/** Clone only selected changed content; cached parsed documents stay immutable. */
export function annotateMarkdownLinks(
  before: readonly MarkdownBlock[],
  after: MarkdownBlock[]
): MarkdownBlock[] {
  const previous = new Map<number, NonNullable<Link["previous"]>>();
  for (const pair of alignMarkdownResources(before, after, "link")) {
    if (
      pair.before &&
      pair.after &&
      (pair.before.url !== pair.after.url ||
        pair.before.title !== pair.after.title)
    )
      previous.set(pair.after.range.startOffset, {
        url: pair.before.url,
        title: pair.before.title,
      });
  }
  if (!previous.size) return after;
  const blocks = structuredClone(after);
  visitMarkdownNodes(blocks, (node) => {
    if (node.kind !== "link") return;
    const value = previous.get(node.range.startOffset);
    if (value) node.previous = value;
  });
  return blocks;
}
