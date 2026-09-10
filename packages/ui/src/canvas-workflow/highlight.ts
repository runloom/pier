import type { WorkflowEdge, WorkflowHover } from "./types.ts";

function attrId(el: Element | null, name: string): string | null {
  if (!el) {
    return null;
  }
  const value = el.getAttribute(name);
  return value && value.length > 0 ? value : null;
}

/** Empty grid / floor returns null so the caller clears hover. */
export function workflowHoverFromTarget(
  target: EventTarget | null
): WorkflowHover {
  if (!(target instanceof Element)) {
    return null;
  }
  const nodeId = attrId(target.closest("[data-node-id]"), "data-node-id");
  if (nodeId) {
    return { id: nodeId, kind: "node" };
  }
  const edgeId = attrId(target.closest("[data-edge-id]"), "data-edge-id");
  if (edgeId) {
    return { id: edgeId, kind: "edge" };
  }
  const artboard = target.closest("[data-artboard-id]");
  if (artboard instanceof HTMLElement && artboard.dataset.artboardId) {
    return { id: artboard.dataset.artboardId, kind: "node" };
  }
  return null;
}

export interface WorkflowHighlight {
  readonly edges: ReadonlySet<string>;
  readonly nodes: ReadonlySet<string>;
}

export function workflowHighlight(
  spec: { readonly edges: readonly WorkflowEdge[] },
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
