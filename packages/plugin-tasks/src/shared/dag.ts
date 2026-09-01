import type {
  TaskBoardSnapshot,
  TaskDagEdge,
  TaskDagSnapshot,
} from "./types.ts";

export function uniqueEdges(edges: readonly TaskDagEdge[]): TaskDagEdge[] {
  const seen = new Set<string>();
  const result: TaskDagEdge[] = [];
  for (const edge of edges) {
    const id = `${edge.from}->${edge.to}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(edge);
  }
  return result;
}

/**
 * The dag projection is a pure derivation of the board snapshot (edges come
 * from each card's open blockers). One tracker fetch feeds both projections.
 */
export function dagFromBoard(board: TaskBoardSnapshot): TaskDagSnapshot {
  const cards = board.columns.flatMap((column) => column.items);
  return {
    cycleKeys: board.cycleKeys,
    edges: uniqueEdges(
      cards.flatMap((card) =>
        card.blockers.map((blocker) => ({ from: blocker.key, to: card.key }))
      )
    ),
    fetchedAt: board.fetchedAt,
    generation: board.generation,
    hasCycle: board.hasCycle,
    nodes: cards.map((card) => ({ key: card.key, title: card.title })),
    params: board.params,
    schemaVersion: board.schemaVersion,
  };
}
