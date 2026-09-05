import { diffArrays } from "diff";
import type { MarkdownBlock, MarkdownInline } from "../../markdown/ir.ts";
import { markdownContentKey, visitMarkdownNodes } from "./nodes.ts";

type Resource = Extract<MarkdownInline, { kind: "link" | "image" }>;
type ResourceOfKind<K extends Resource["kind"]> = Extract<
  Resource,
  { kind: K }
>;
interface ResourcePair<K extends Resource["kind"]> {
  after: ResourceOfKind<K> | undefined;
  before: ResourceOfKind<K> | undefined;
}

function compatible(a: Resource, b: Resource): boolean {
  if (a.url === b.url) return true;
  if (a.kind === "image" && b.kind === "image") return a.alt === b.alt;
  return (
    a.kind === "link" &&
    b.kind === "link" &&
    markdownContentKey(a.children) === markdownContentKey(b.children)
  );
}

/** Unchanged resources anchor edits before matching labels or targets. */
export function alignMarkdownResources<K extends Resource["kind"]>(
  before: readonly MarkdownBlock[],
  after: readonly MarkdownBlock[],
  kind: K
): ResourcePair<K>[] {
  const collect = (blocks: readonly MarkdownBlock[]) => {
    const links: ResourceOfKind<K>[] = [];
    visitMarkdownNodes(blocks, (node) => {
      if (node.kind === kind) links.push(node as ResourceOfKind<K>);
    });
    return links;
  };
  const pairs: ResourcePair<K>[] = [];
  const align = (
    oldLinks: ResourceOfKind<K>[],
    newLinks: ResourceOfKind<K>[],
    exact: boolean
  ) => {
    if (!(oldLinks.length && newLinks.length)) {
      pairs.push(
        ...oldLinks.map((before) => ({ before, after: undefined })),
        ...newLinks.map((after) => ({ before: undefined, after }))
      );
      return;
    }
    const parts = diffArrays(oldLinks, newLinks, {
      comparator: (a, b) =>
        exact
          ? markdownContentKey(a) === markdownContentKey(b)
          : compatible(a, b),
      maxEditLength: 400,
      timeout: 25,
    });
    if (!parts) throw new Error("markdown-diff-too-large");
    let oldIndex = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      if (!(part.added || part.removed)) {
        for (const current of part.value) {
          const old = oldLinks[oldIndex++]!;
          pairs.push({ before: old, after: current });
        }
        continue;
      }
      const removed: ResourceOfKind<K>[] = [];
      const added: ResourceOfKind<K>[] = [];
      while (
        index < parts.length &&
        (parts[index]!.added || parts[index]!.removed)
      ) {
        const change = parts[index++]!;
        if (change.removed) {
          removed.push(...change.value);
          oldIndex += change.value.length;
        } else {
          added.push(...change.value);
        }
      }
      index--;
      if (exact) align(removed, added, false);
      else
        pairs.push(
          ...removed.map((before) => ({ before, after: undefined })),
          ...added.map((after) => ({ before: undefined, after }))
        );
    }
  };
  align(collect(before), collect(after), true);
  return pairs;
}
