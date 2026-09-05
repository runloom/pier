import { diffArrays } from "diff";
import type { MarkdownInline } from "../../markdown/ir.ts";
import { markdownContentKey, visitMarkdownNodes } from "./nodes.ts";

function isPreviousLink(
  before: MarkdownInline,
  after: MarkdownInline
): boolean {
  return (
    before.kind === "link" &&
    after.kind === "link" &&
    before.url === after.previous?.url &&
    before.title === after.previous?.title
  );
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const INLINE_LIMIT = 16_000;

function mark(
  inline: MarkdownInline,
  change: "added" | "deleted"
): MarkdownInline {
  return { ...inline, change };
}

function diffText(
  before: Extract<MarkdownInline, { kind: "text" }>,
  after: Extract<MarkdownInline, { kind: "text" }>
): MarkdownInline[] {
  const split = (value: string) =>
    Array.from(segmenter.segment(value), (part) => part.segment);
  const parts = diffArrays(split(before.value), split(after.value), {
    maxEditLength: 800,
    timeout: 25,
  });
  if (!parts) return [mark(before, "deleted"), mark(after, "added")];
  return parts.map((part) => {
    const node = {
      ...(part.removed ? before : after),
      value: part.value.join(""),
    };
    if (part.removed) return mark(node, "deleted");
    return part.added ? mark(node, "added") : node;
  });
}

function mergeInline(
  before: MarkdownInline,
  after: MarkdownInline
): MarkdownInline[] {
  if (before.kind === "text" && after.kind === "text")
    return diffText(before, after);
  if (
    before.kind === after.kind &&
    "children" in before &&
    "children" in after
  ) {
    const beforeShape = markdownContentKey({ ...before, children: [] });
    const afterShape = markdownContentKey({ ...after, children: [] });
    if (beforeShape === afterShape || isPreviousLink(before, after)) {
      const children = diffMarkdownInlines(before.children, after.children);
      if (children) return [{ ...after, children }];
    }
  }
  return [mark(before, "deleted"), mark(after, "added")];
}

/** Reuse native jsdiff and the existing inline renderer; retain whitespace and marks. */
export function diffMarkdownInlines(
  before: MarkdownInline[],
  after: MarkdownInline[]
): MarkdownInline[] | null {
  if (
    markdownContentKey(before).length + markdownContentKey(after).length >
    INLINE_LIMIT
  )
    return null;
  // HTML tokens, images and footnotes need their original document context,
  // including when nested inside emphasis or a link.
  let contextual = false;
  visitMarkdownNodes([...before, ...after], (node) => {
    if (
      node.kind === "html" ||
      node.kind === "image" ||
      node.kind === "footnoteReference"
    )
      contextual = true;
  });
  if (contextual) return null;
  const parts = diffArrays(before, after, {
    comparator: (a, b) =>
      markdownContentKey(a) === markdownContentKey(b) ||
      (isPreviousLink(a, b) &&
        "children" in a &&
        "children" in b &&
        markdownContentKey(a.children) === markdownContentKey(b.children)),
    maxEditLength: 400,
    timeout: 25,
  });
  if (!parts) return null;
  const output: MarkdownInline[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (!(part.added || part.removed)) {
      output.push(...part.value);
      continue;
    }
    const removed: MarkdownInline[] = [];
    const added: MarkdownInline[] = [];
    let next = index;
    while (
      next < parts.length &&
      (parts[next]!.added || parts[next]!.removed)
    ) {
      const change = parts[next++]!;
      (change.removed ? removed : added).push(...change.value);
    }
    index = next - 1;
    for (
      let position = 0;
      position < Math.max(removed.length, added.length);
      position++
    ) {
      const oldNode = removed[position];
      const newNode = added[position];
      if (oldNode && newNode) output.push(...mergeInline(oldNode, newNode));
      else if (oldNode) output.push(mark(oldNode, "deleted"));
      else if (newNode) output.push(mark(newNode, "added"));
    }
  }
  return output;
}
