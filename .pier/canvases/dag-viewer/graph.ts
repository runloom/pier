/** Parse / poll helpers for the orchestration gold canvas. */

export type NodeStatus =
  | "blocked"
  | "failed"
  | "queued"
  | "ready"
  | "running"
  | "skipped"
  | "success";
export type Positions = Record<string, { x: number; y: number }>;
export type GraphNode = {
  badge?: string;
  id: string;
  label: string;
  meta?: string;
  status?: NodeStatus;
};
export type GraphEdge = { label?: string; source: string; target: string };

export const FALLBACK_NODES: GraphNode[] = [
  {
    badge: "lead",
    id: "plan",
    label: "Plan",
    meta: "signed off",
    status: "success",
  },
  { id: "run", label: "Run", meta: "worker-2", status: "running" },
  {
    badge: "gate",
    id: "review",
    label: "Review",
    meta: "needs sign-off",
    status: "blocked",
  },
  { id: "ship", label: "Ship", status: "ready" },
];

export const FALLBACK_EDGES: GraphEdge[] = [
  { label: "ok", source: "plan", target: "run" },
  { source: "run", target: "review" },
  { source: "review", target: "ship" },
];

export const LOOPBACK_GRAPH = "http://127.0.0.1:8787/graph";
export const LOOPBACK_TIMEOUT_MS = 800;
export const LOOPBACK_POLL_MS = 3000;
/** Stop polling after this many consecutive loopback misses; Refresh restarts. */
export const LOOPBACK_MISS_LIMIT = 3;

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStatus(value: unknown): NodeStatus | undefined {
  if (value === "dispatched") {
    return "running";
  }
  if (
    value === "blocked" ||
    value === "failed" ||
    value === "queued" ||
    value === "ready" ||
    value === "running" ||
    value === "skipped" ||
    value === "success"
  ) {
    return value;
  }
  return undefined;
}

function parseNode(node: {
  badge?: unknown;
  id?: unknown;
  label?: unknown;
  meta?: unknown;
  status?: unknown;
}): GraphNode[] {
  if (typeof node.id !== "string" || typeof node.label !== "string") {
    return [];
  }
  const parsed: GraphNode = { id: node.id, label: node.label };
  const status = asStatus(node.status);
  const badge = asOptionalString(node.badge);
  const meta = asOptionalString(node.meta);
  if (status) {
    parsed.status = status;
  }
  if (badge) {
    parsed.badge = badge;
  }
  if (meta) {
    parsed.meta = meta;
  }
  return [parsed];
}

function parseEdge(edge: {
  label?: unknown;
  source?: unknown;
  target?: unknown;
}): GraphEdge[] {
  if (typeof edge.source !== "string" || typeof edge.target !== "string") {
    return [];
  }
  const parsed: GraphEdge = { source: edge.source, target: edge.target };
  const label = asOptionalString(edge.label);
  if (label) {
    parsed.label = label;
  }
  return [parsed];
}

export function parseGraph(text: string): {
  edges: GraphEdge[];
  nodes: GraphNode[];
} | null {
  try {
    const data = JSON.parse(text) as {
      edges?: {
        label?: unknown;
        source?: unknown;
        target?: unknown;
      }[];
      nodes?: {
        badge?: unknown;
        id?: unknown;
        label?: unknown;
        meta?: unknown;
        status?: unknown;
      }[];
    };
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return null;
    }
    return {
      edges: data.edges.flatMap(parseEdge),
      nodes: data.nodes.flatMap(parseNode),
    };
  } catch {
    return null;
  }
}

export function parsePositions(text: string): Positions {
  try {
    const data = JSON.parse(text) as {
      positions?: Record<string, { x?: unknown; y?: unknown }>;
    };
    if (!data.positions || typeof data.positions !== "object") {
      return {};
    }
    const result: Positions = {};
    for (const [key, value] of Object.entries(data.positions)) {
      if (
        value &&
        typeof value === "object" &&
        typeof value.x === "number" &&
        Number.isFinite(value.x) &&
        typeof value.y === "number" &&
        Number.isFinite(value.y)
      ) {
        result[key] = { x: value.x, y: value.y };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchLoopbackGraph(): Promise<{
  edges: GraphEdge[];
  nodes: GraphNode[];
} | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    LOOPBACK_TIMEOUT_MS
  );
  try {
    const response = await fetch(LOOPBACK_GRAPH, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    return parseGraph(await response.text());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function textFromRunOutput(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return "";
  }
  const chunks = (raw as { chunks?: unknown }).chunks;
  if (!Array.isArray(chunks)) {
    return "";
  }
  return chunks
    .map((chunk) => {
      if (!(chunk && typeof chunk === "object")) {
        return "";
      }
      const text = (chunk as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

export function isTerminalRunStatus(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const status = (raw as { status?: unknown }).status;
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  );
}
