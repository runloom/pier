/**
 * Portable plan graph helpers for `.pier/plans/**` canvases.
 *
 * Lives under `.pier/plans/lib` so user projects (and this dogfood) import
 * relatively — never `src/shared/...` (that path only exists in the Pier
 * monorepo). No Zod / no Node — React Live Module fence-safe.
 */

export type PlanNodeStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

export type PlanBoardColumn = "backlog" | "doing" | "review" | "done";

export interface PlanSessionRef {
  agentId?: string;
  boundAt: string;
  panelHint?: string;
  role?: "implement" | "review" | "explore";
  sessionId: string;
}

export interface PlanNode {
  acceptance?: string[];
  column?: PlanBoardColumn;
  deps: string[];
  docRefs?: string[];
  id: string;
  notes?: string;
  paths?: string[];
  sessionRefs?: PlanSessionRef[];
  status: PlanNodeStatus;
  title: string;
}

/** Optional narrative for the 需求 tab (product + tech design). */
export interface PlanBrief {
  goals?: string[];
  nonGoals?: string[];
  problem?: string;
  product?: string;
  success?: string[];
  tech?: string;
}

export interface PlanDocument {
  brief?: PlanBrief;
  description?: string;
  edges?: Array<{ from: string; to: string }>;
  id: string;
  nodes: PlanNode[];
  title: string;
  updatedAt: string;
  version: 1;
}

export function statusToColumn(status: PlanNodeStatus): PlanBoardColumn {
  switch (status) {
    case "todo":
      return "backlog";
    case "in_progress":
      return "doing";
    case "blocked":
      return "review";
    case "done":
    case "cancelled":
      return "done";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function assertPlanDepsExist(nodes: readonly PlanNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const dep of node.deps) {
      if (!ids.has(dep)) {
        throw new Error(
          `Plan node "${node.id}" depends on missing id "${dep}"`
        );
      }
    }
  }
}

/** Reject cycles in the deps graph (edge: dep → node). */
export function assertPlanAcyclic(nodes: readonly PlanNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, stack: string[]): void {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id].join(" → ");
      throw new Error(`Plan has a dependency cycle: ${cycle}`);
    }
    visiting.add(id);
    const node = byId.get(id);
    if (node) {
      for (const dep of node.deps) {
        visit(dep, [...stack, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) {
    visit(node.id, []);
  }
}

export interface PlanLayoutNode {
  id: string;
  indexInLayer: number;
  layer: number;
  node: PlanNode;
  x: number;
  y: number;
}

export interface PlanLayoutResult {
  height: number;
  nodes: PlanLayoutNode[];
  width: number;
}

export interface LayeredLayoutOptions {
  gapX?: number;
  gapY?: number;
  nodeHeight?: number;
  nodeWidth?: number;
  paddingX?: number;
  paddingY?: number;
}

/**
 * Longest-path layering for a DAG (dep → dependent flows downward).
 * D0 self-drawn dag canvas uses this — no diagram library.
 */
export function layeredLayout(
  nodes: readonly PlanNode[],
  options: LayeredLayoutOptions = {}
): PlanLayoutResult {
  assertPlanDepsExist(nodes);
  assertPlanAcyclic(nodes);

  const nodeWidth = options.nodeWidth ?? 200;
  const nodeHeight = options.nodeHeight ?? 72;
  const gapX = options.gapX ?? 24;
  const gapY = options.gapY ?? 40;
  const paddingX = options.paddingX ?? 16;
  const paddingY = options.paddingY ?? 16;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const layerMemo = new Map<string, number>();

  function layerOf(id: string): number {
    const cached = layerMemo.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const node = byId.get(id);
    if (!node || node.deps.length === 0) {
      layerMemo.set(id, 0);
      return 0;
    }
    let maxDep = 0;
    for (const dep of node.deps) {
      maxDep = Math.max(maxDep, layerOf(dep) + 1);
    }
    layerMemo.set(id, maxDep);
    return maxDep;
  }

  const layers = new Map<number, PlanNode[]>();
  for (const node of nodes) {
    const layer = layerOf(node.id);
    const bucket = layers.get(layer) ?? [];
    bucket.push(node);
    layers.set(layer, bucket);
  }

  const orderIndex = new Map(nodes.map((node, index) => [node.id, index]));
  for (const bucket of layers.values()) {
    bucket.sort(
      (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0)
    );
  }

  const maxLayer = Math.max(0, ...layers.keys());
  let maxInLayer = 1;
  for (const bucket of layers.values()) {
    maxInLayer = Math.max(maxInLayer, bucket.length);
  }

  const layoutNodes: PlanLayoutNode[] = [];
  const fullRowWidth =
    maxInLayer * nodeWidth + Math.max(0, maxInLayer - 1) * gapX;

  for (let layer = 0; layer <= maxLayer; layer += 1) {
    const bucket = layers.get(layer) ?? [];
    const rowWidth =
      bucket.length * nodeWidth + Math.max(0, bucket.length - 1) * gapX;
    const startX = paddingX + Math.max(0, (fullRowWidth - rowWidth) / 2);
    for (const [indexInLayer, node] of bucket.entries()) {
      layoutNodes.push({
        id: node.id,
        indexInLayer,
        layer,
        node,
        x: startX + indexInLayer * (nodeWidth + gapX),
        y: paddingY + layer * (nodeHeight + gapY),
      });
    }
  }

  const width = paddingX * 2 + fullRowWidth;
  const height =
    paddingY * 2 + (maxLayer + 1) * nodeHeight + Math.max(0, maxLayer) * gapY;

  return { height, nodes: layoutNodes, width };
}

export function edgesFromNodes(
  nodes: readonly PlanNode[]
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of nodes) {
    for (const dep of node.deps) {
      edges.push({ from: dep, to: node.id });
    }
  }
  return edges;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }
  return value.filter((line): line is string => typeof line === "string");
}

function parseBoardColumn(value: unknown): PlanBoardColumn | undefined {
  if (
    value === "backlog" ||
    value === "doing" ||
    value === "review" ||
    value === "done"
  ) {
    return value;
  }
  return;
}

function parseSessionRef(ref: unknown): PlanSessionRef | null {
  if (ref === null || typeof ref !== "object") {
    return null;
  }
  const r = ref as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || typeof r.boundAt !== "string") {
    return null;
  }
  const role = r.role;
  const roleOk =
    role === "implement" || role === "review" || role === "explore"
      ? role
      : undefined;
  return {
    agentId: typeof r.agentId === "string" ? r.agentId : undefined,
    boundAt: r.boundAt,
    panelHint: typeof r.panelHint === "string" ? r.panelHint : undefined,
    role: roleOk,
    sessionId: r.sessionId,
  };
}

function parsePlanNode(item: unknown, index: number): PlanNode {
  if (item === null || typeof item !== "object") {
    throw new Error(`Plan node at ${index} is invalid`);
  }
  const n = item as Record<string, unknown>;
  if (typeof n.id !== "string" || typeof n.title !== "string") {
    throw new Error(`Plan node at ${index} needs id and title`);
  }
  const status = n.status;
  if (
    status !== "todo" &&
    status !== "in_progress" &&
    status !== "blocked" &&
    status !== "done" &&
    status !== "cancelled"
  ) {
    throw new Error(`Plan node "${n.id}" has invalid status`);
  }
  const deps = Array.isArray(n.deps)
    ? n.deps.filter((dep): dep is string => typeof dep === "string")
    : [];
  const sessionRefs = Array.isArray(n.sessionRefs)
    ? n.sessionRefs
        .map(parseSessionRef)
        .filter((ref): ref is PlanSessionRef => ref !== null)
    : undefined;
  return {
    acceptance: stringList(n.acceptance),
    column: parseBoardColumn(n.column),
    deps,
    docRefs: stringList(n.docRefs),
    id: n.id,
    notes: typeof n.notes === "string" ? n.notes : undefined,
    paths: stringList(n.paths),
    sessionRefs:
      sessionRefs && sessionRefs.length > 0 ? sessionRefs : undefined,
    status,
    title: n.title,
  };
}

function parseBrief(value: unknown): PlanBrief | undefined {
  if (value === null || typeof value !== "object") {
    return;
  }
  const b = value as Record<string, unknown>;
  return {
    goals: stringList(b.goals),
    nonGoals: stringList(b.nonGoals),
    problem: typeof b.problem === "string" ? b.problem : undefined,
    product: typeof b.product === "string" ? b.product : undefined,
    success: stringList(b.success),
    tech: typeof b.tech === "string" ? b.tech : undefined,
  };
}

/** Lightweight runtime check for canvas (no Zod). */
export function readPlanDocument(input: unknown): PlanDocument {
  if (input === null || typeof input !== "object") {
    throw new Error("Plan document must be an object");
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("Plan document version must be 1");
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error("Plan document id is required");
  }
  if (typeof raw.title !== "string" || raw.title.length === 0) {
    throw new Error("Plan document title is required");
  }
  if (typeof raw.updatedAt !== "string") {
    throw new Error("Plan document updatedAt is required");
  }
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error("Plan document nodes must be a non-empty array");
  }
  const nodes = raw.nodes.map((item, index) => parsePlanNode(item, index));
  assertPlanDepsExist(nodes);
  assertPlanAcyclic(nodes);
  return {
    brief: parseBrief(raw.brief),
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    id: raw.id,
    nodes,
    title: raw.title,
    updatedAt: raw.updatedAt,
    version: 1,
  };
}

/** Immutable status update helper for canvas local state. */
export function withNodeStatus(
  plan: PlanDocument,
  nodeId: string,
  status: PlanNodeStatus
): PlanDocument {
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id === nodeId ? { ...node, status } : node
    ),
    updatedAt: new Date().toISOString(),
  };
}

/** Replace deps for a node (must remain acyclic). */
export function withNodeDeps(
  plan: PlanDocument,
  nodeId: string,
  deps: string[]
): PlanDocument {
  const next: PlanDocument = {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id === nodeId ? { ...node, deps: [...deps] } : node
    ),
    updatedAt: new Date().toISOString(),
  };
  assertPlanDepsExist(next.nodes);
  assertPlanAcyclic(next.nodes);
  return next;
}
