import type { TaskDagEdgeModel, TaskDagNodeModel } from "./hooks.ts";

/** Stop using this layout when crossings exceed this bar. */
export const DAG_LAYOUT_CROSSING_EXIT = 12;

export interface DagLayout {
  crossings: number;
  layers: readonly (readonly string[])[];
}

/**
 * Longest-path layering over the blocker graph (edge from → to means "from
 * blocks to"). Nodes stuck in cycles never reach zero in-degree and land in a
 * trailing layer. Crossings are counted pairwise between adjacent layers using
 * the stable within-layer order; the caller compares against
 * `DAG_LAYOUT_CROSSING_EXIT` (experimental quality bar).
 */
export function layerDagNodes(input: {
  edges: readonly TaskDagEdgeModel[];
  nodes: readonly TaskDagNodeModel[];
}): DagLayout {
  const known = new Set(input.nodes.map((node) => node.key));
  const edges = input.edges.filter(
    (edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to
  );
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of input.nodes) {
    incoming.set(node.key, 0);
  }
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const layers: string[][] = [];
  const placed = new Set<string>();
  let frontier = input.nodes
    .filter((node) => (incoming.get(node.key) ?? 0) === 0)
    .map((node) => node.key);
  const remainingIncoming = new Map(incoming);
  while (frontier.length > 0) {
    layers.push(frontier);
    for (const key of frontier) {
      placed.add(key);
    }
    const next = new Set<string>();
    for (const key of frontier) {
      for (const target of outgoing.get(key) ?? []) {
        const left = (remainingIncoming.get(target) ?? 0) - 1;
        remainingIncoming.set(target, left);
        if (left === 0 && !placed.has(target)) {
          next.add(target);
        }
      }
    }
    frontier = input.nodes
      .filter((node) => next.has(node.key))
      .map((node) => node.key);
  }
  const leftover = input.nodes
    .filter((node) => !placed.has(node.key))
    .map((node) => node.key);
  if (leftover.length > 0) {
    // Cycle members (and everything downstream of them).
    layers.push(leftover);
  }

  const layerOf = new Map<string, number>();
  const indexOf = new Map<string, number>();
  layers.forEach((layer, layerIndex) => {
    layer.forEach((key, index) => {
      layerOf.set(key, layerIndex);
      indexOf.set(key, index);
    });
  });

  let crossings = 0;
  const spans = edges
    .filter((edge) => {
      const from = layerOf.get(edge.from);
      const to = layerOf.get(edge.to);
      return from !== undefined && to !== undefined && from !== to;
    })
    .map((edge) => ({
      from: indexOf.get(edge.from) ?? 0,
      layer: Math.min(layerOf.get(edge.from) ?? 0, layerOf.get(edge.to) ?? 0),
      to: indexOf.get(edge.to) ?? 0,
    }));
  for (let i = 0; i < spans.length; i += 1) {
    const left = spans[i];
    if (!left) {
      continue;
    }
    for (let j = i + 1; j < spans.length; j += 1) {
      const right = spans[j];
      if (!right || left.layer !== right.layer) {
        continue;
      }
      if ((left.from - right.from) * (left.to - right.to) < 0) {
        crossings += 1;
      }
    }
  }
  return { crossings, layers };
}
