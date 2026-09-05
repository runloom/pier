import type { MarkdownBlock } from "../../markdown/ir.ts";
import { alignMarkdownResources } from "./resources.ts";

export interface MarkdownAttributeChange {
  after: string;
  before: string;
  kind: "link" | "image";
}

export function changedMarkdownAttributes(
  before: readonly MarkdownBlock[],
  after: readonly MarkdownBlock[]
): MarkdownAttributeChange[] {
  const changes: MarkdownAttributeChange[] = [];
  for (const pair of alignMarkdownResources(before, after, "link")) {
    // Ordinary link additions/deletions are already visible in the prose.
    if (!(pair.before && pair.after)) continue;
    for (const field of ["url", "title"] as const) {
      const oldValue = pair.before?.[field] ?? "";
      const newValue = pair.after?.[field] ?? "";
      if (oldValue !== newValue)
        changes.push({
          kind: "link",
          before: oldValue,
          after: newValue,
        });
    }
  }
  for (const pair of alignMarkdownResources(before, after, "image")) {
    for (const field of ["url", "title", "alt"] as const) {
      const oldValue = pair.before?.[field] ?? "";
      const newValue = pair.after?.[field] ?? "";
      if (oldValue !== newValue)
        changes.push({ kind: "image", before: oldValue, after: newValue });
    }
  }
  return [
    ...new Map(
      changes.map((change) => [JSON.stringify(change), change])
    ).values(),
  ];
}
