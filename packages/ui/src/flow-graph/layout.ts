/**
 * Layered DAG layout (Sugiyama-lite): longest-path ranks via Kahn, one
 * barycenter pass, then orthogonal placement. Not dagre — no new dependency.
 */
import {
  FLOW_GRAPH_NODE_HEIGHT,
  FLOW_GRAPH_NODE_SEP,
  FLOW_GRAPH_NODE_WIDTH,
  FLOW_GRAPH_PADDING,
  FLOW_GRAPH_RANK_SEP,
  type FlowGraphDirection,
  type FlowGraphPosition,
  type FlowGraphPositions,
  flowGraphNodeSize,
} from "./model.ts";

export interface FlowGraphLayoutNode {
  contentHeight?: number | undefined;
  height?: number | undefined;
  id: string;
  meta?: string | undefined;
  width?: number | undefined;
}

export interface FlowGraphLayoutEdge {
  label?: string | undefined;
  source: string;
  target: string;
}

export interface LaidOutFlowGraphEdge {
  d: string;
  label?: string | undefined;
  labelX: number;
  labelY: number;
  source: string;
  target: string;
}

export interface FlowGraphLayout {
  edges: LaidOutFlowGraphEdge[];
  height: number;
  positions: FlowGraphPositions;
  width: number;
}

function outgoingMap(
  ids: readonly string[],
  edges: readonly FlowGraphLayoutEdge[]
): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    outgoing.set(id, []);
  }
  const known = new Set(ids);
  for (const edge of edges) {
    if (!(known.has(edge.source) && known.has(edge.target))) {
      continue;
    }
    const list = outgoing.get(edge.source);
    if (list && !list.includes(edge.target)) {
      list.push(edge.target);
    }
  }
  return outgoing;
}

/** Kahn layers; leftover cyclic nodes sit in a final rank. */
export function assignFlowGraphRanks(
  ids: readonly string[],
  edges: readonly FlowGraphLayoutEdge[]
): Map<string, number> {
  const outgoing = outgoingMap(ids, edges);
  const indegree = new Map<string, number>();
  for (const id of ids) {
    indegree.set(id, 0);
  }
  for (const targets of outgoing.values()) {
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const rank = new Map<string, number>();
  const remaining = new Set(ids);
  let frontier = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  let layer = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      rank.set(id, layer);
      remaining.delete(id);
      for (const target of outgoing.get(id) ?? []) {
        if (!remaining.has(target)) {
          continue;
        }
        const nextDeg = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, nextDeg);
        if (nextDeg === 0) {
          next.push(target);
        }
      }
    }
    frontier = next;
    layer += 1;
  }
  for (const id of remaining) {
    rank.set(id, layer);
  }
  return rank;
}

function groupByRank(
  ids: readonly string[],
  rank: Map<string, number>
): string[][] {
  let maxRank = 0;
  for (const id of ids) {
    maxRank = Math.max(maxRank, rank.get(id) ?? 0);
  }
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of ids) {
    const layer = layers[rank.get(id) ?? 0];
    layer?.push(id);
  }
  return layers;
}

function barycenterOrder(
  layers: string[][],
  edges: readonly FlowGraphLayoutEdge[]
): string[][] {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const parentList = parents.get(edge.target) ?? [];
    if (!parentList.includes(edge.source)) {
      parentList.push(edge.source);
      parents.set(edge.target, parentList);
    }
    const childList = children.get(edge.source) ?? [];
    if (!childList.includes(edge.target)) {
      childList.push(edge.target);
      children.set(edge.source, childList);
    }
  }
  const ordered = layers.map((layer) => [...layer]);
  const sortLayer = (
    index: number,
    neighborIndex: number,
    links: Map<string, string[]>
  ): void => {
    const layer = ordered[index];
    const neighbors = ordered[neighborIndex];
    if (!(layer && neighbors)) {
      return;
    }
    const neighborPos = new Map(neighbors.map((id, i) => [id, i]));
    const currentPos = new Map(layer.map((id, i) => [id, i]));
    layer.sort((a, b) => {
      const avg = (id: string): number => {
        const linked = (links.get(id) ?? [])
          .map((peer) => neighborPos.get(peer))
          .filter((value): value is number => value !== undefined);
        if (linked.length === 0) {
          // Unlinked nodes hold their spot instead of drifting to the end.
          return currentPos.get(id) ?? neighborPos.size;
        }
        return linked.reduce((sum, value) => sum + value, 0) / linked.length;
      };
      const delta = avg(a) - avg(b);
      if (delta !== 0) {
        return delta;
      }
      return a.localeCompare(b);
    });
  };
  // One Sugiyama sweep pair: down (by parents) then up (by children).
  for (let index = 1; index < ordered.length; index += 1) {
    sortLayer(index, index - 1, parents);
  }
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    sortLayer(index, index + 1, children);
  }
  return ordered;
}

export function flowGraphEdgeAnchors(input: {
  direction: FlowGraphDirection;
  source: FlowGraphPosition & { height: number; width: number };
  target: FlowGraphPosition & { height: number; width: number };
}): { x1: number; x2: number; y1: number; y2: number } {
  if (input.direction === "top-to-bottom") {
    return {
      x1: input.source.x + input.source.width / 2,
      x2: input.target.x + input.target.width / 2,
      y1: input.source.y + input.source.height,
      y2: input.target.y,
    };
  }
  return {
    x1: input.source.x + input.source.width,
    x2: input.target.x,
    y1: input.source.y + input.source.height / 2,
    y2: input.target.y + input.target.height / 2,
  };
}

export function flowGraphEdgePath(input: {
  direction: FlowGraphDirection;
  source: FlowGraphPosition & { height: number; width: number };
  target: FlowGraphPosition & { height: number; width: number };
}): string {
  const { x1, x2, y1, y2 } = flowGraphEdgeAnchors(input);
  if (input.direction === "top-to-bottom") {
    const mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
  }
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function layoutFlowGraph(input: {
  direction?: FlowGraphDirection | undefined;
  edges: readonly FlowGraphLayoutEdge[];
  nodeHeight?: number | undefined;
  nodeWidth?: number | undefined;
  nodes: readonly FlowGraphLayoutNode[];
  padding?: number | undefined;
  positions?: Readonly<FlowGraphPositions> | undefined;
}): FlowGraphLayout {
  const direction = input.direction ?? "left-to-right";
  const padding = input.padding ?? FLOW_GRAPH_PADDING;
  const defaultWidth = input.nodeWidth ?? FLOW_GRAPH_NODE_WIDTH;
  const defaultHeight = input.nodeHeight ?? FLOW_GRAPH_NODE_HEIGHT;
  const ids = input.nodes.map((node) => node.id);
  const sizeById = new Map(
    input.nodes.map((node) => {
      const slotted = flowGraphNodeSize(node);
      return [
        node.id,
        {
          height: node.height ?? slotted.height,
          width: node.width ?? slotted.width,
        },
      ];
    })
  );
  const known = new Set(ids);
  const edges = input.edges.filter(
    (edge) => known.has(edge.source) && known.has(edge.target)
  );
  const ranks = assignFlowGraphRanks(ids, edges);
  const layers = barycenterOrder(groupByRank(ids, ranks), edges);
  const auto: FlowGraphPositions = {};
  if (direction === "top-to-bottom") {
    let y = padding;
    for (const layer of layers) {
      let x = padding;
      let rowHeight = 0;
      for (const id of layer) {
        if (!id) {
          continue;
        }
        const size = sizeById.get(id) ?? {
          height: defaultHeight,
          width: defaultWidth,
        };
        auto[id] = { x, y };
        x += size.width + FLOW_GRAPH_NODE_SEP;
        rowHeight = Math.max(rowHeight, size.height);
      }
      y += rowHeight + FLOW_GRAPH_RANK_SEP;
    }
  } else {
    let x = padding;
    for (const layer of layers) {
      let y = padding;
      let colWidth = 0;
      for (const id of layer) {
        if (!id) {
          continue;
        }
        const size = sizeById.get(id) ?? {
          height: defaultHeight,
          width: defaultWidth,
        };
        auto[id] = { x, y };
        y += size.height + FLOW_GRAPH_NODE_SEP;
        colWidth = Math.max(colWidth, size.width);
      }
      x += colWidth + FLOW_GRAPH_RANK_SEP;
    }
  }
  const positions: FlowGraphPositions = { ...auto, ...input.positions };
  const laidEdges: LaidOutFlowGraphEdge[] = [];
  let width = padding;
  let height = padding;
  for (const node of input.nodes) {
    const position = positions[node.id];
    const size = sizeById.get(node.id);
    if (!(position && size)) {
      continue;
    }
    width = Math.max(width, position.x + size.width + padding);
    height = Math.max(height, position.y + size.height + padding);
  }
  for (const edge of edges) {
    const sourcePos = positions[edge.source];
    const targetPos = positions[edge.target];
    const sourceSize = sizeById.get(edge.source);
    const targetSize = sizeById.get(edge.target);
    if (!(sourcePos && targetPos && sourceSize && targetSize)) {
      continue;
    }
    const anchors = {
      direction,
      source: { ...sourcePos, ...sourceSize },
      target: { ...targetPos, ...targetSize },
    };
    const { x1, x2, y1, y2 } = flowGraphEdgeAnchors(anchors);
    laidEdges.push({
      d: flowGraphEdgePath(anchors),
      ...(edge.label ? { label: edge.label } : {}),
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2 - 8,
      source: edge.source,
      target: edge.target,
    });
  }
  return { edges: laidEdges, height, positions, width };
}
