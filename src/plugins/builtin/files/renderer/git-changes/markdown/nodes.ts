import type { MarkdownBlock, MarkdownInline } from "../../markdown/ir.ts";

type Node = MarkdownBlock | MarkdownInline;

/** Source positions and comparison annotations are not Markdown content. */
export function markdownContentKey(value: object): string {
  return JSON.stringify(value, (key, entry) =>
    key === "range" || key === "definitionRange" || key === "previous"
      ? undefined
      : entry
  );
}

/** Normal prose collapses ASCII whitespace; code and resource values do not. */
export function markdownVisibleContentKey(block: MarkdownBlock): string {
  const copy = structuredClone(block);
  visitMarkdownNodes([copy], (node) => {
    if (node.kind === "text")
      node.value = node.value.replace(/[\t\n\r\f ]+/gu, " ");
  });
  return markdownContentKey(copy);
}

export function visitMarkdownNodes(
  nodes: readonly Node[],
  visit: (node: Node) => void
): void {
  for (const node of nodes) {
    visit(node);
    if ("children" in node) visitMarkdownNodes(node.children, visit);
    if ("blocks" in node) visitMarkdownNodes(node.blocks, visit);
    if (node.kind === "list")
      for (const item of node.items) visitMarkdownNodes(item.blocks, visit);
    if (node.kind === "table")
      for (const row of node.rows)
        for (const cell of row.cells) visitMarkdownNodes(cell.children, visit);
  }
}
