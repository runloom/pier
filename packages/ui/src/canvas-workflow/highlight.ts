import type { WorkflowHover, WorkflowSpec } from "./types.ts";

export interface WorkflowHighlight {
  readonly edges: ReadonlySet<string>;
  readonly nodes: ReadonlySet<string>;
}

export function workflowHighlight(
  spec: WorkflowSpec,
  hover: WorkflowHover
): WorkflowHighlight {
  if (!hover) {
    return { nodes: new Set(), edges: new Set() };
  }
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (hover.kind === "node") {
    nodes.add(hover.id);
    for (const edge of spec.edges) {
      if (edge.from !== hover.id && edge.to !== hover.id) {
        continue;
      }
      edges.add(edge.id);
      nodes.add(edge.from);
      nodes.add(edge.to);
    }
    return { nodes, edges };
  }
  const edge = spec.edges.find((item) => item.id === hover.id);
  if (edge) {
    edges.add(edge.id);
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  return { nodes, edges };
}

export function workflowHighlightActive(highlight: WorkflowHighlight): boolean {
  return highlight.nodes.size > 0 || highlight.edges.size > 0;
}
