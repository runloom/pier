import rawData from "./data.json";

/**
 * Typed access to the adjacent comparison payload. data.json is imported
 * statically (resolveJsonModule gives compile-time shape), and this module
 * re-checks the few load-bearing invariants at load time so a broken payload
 * fails loudly instead of rendering fabricated content.
 *
 * No bare-package imports here: the live-modules fence allows React canvases
 * only react/react-dom/pier/canvas/pier/host.
 */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type RawRecord = { [key: string]: JsonValue | undefined };

export type MermaidKind = "actor" | "agent" | "tool" | "artifact" | "external";
export type MermaidTone =
  | "danger"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";

/** Node/edge shapes whose optional fields are absent instead of undefined. */
export type MermaidNode = {
  id: string;
  kind?: MermaidKind;
  meta?: string;
  title: string;
  tone?: MermaidTone;
};

export type MermaidEdge = {
  source: string;
  target: string;
  label?: string;
};

export type DiagramPayload = {
  edges: MermaidEdge[];
  nodes: MermaidNode[];
};

export type SystemCard = {
  api: string[];
  diagram: DiagramPayload;
  distribution: string;
  domain: string;
  evidence: string[];
  id: "pier" | "pi" | "deepseek" | "herdr";
  loading: string;
  name: string;
  tagline: string;
  trust: string[];
  unit: string;
};

export type ComparisonData = {
  alternatives: Array<{ name: string; rejectReason: string }>;
  bluf: string;
  context: string;
  design: {
    convergence: string[];
    dimensions: Array<{
      deepseek: string;
      dimension: string;
      herdr: string;
      pi: string;
      pier: string;
    }>;
    divergence: string[];
    loopDiagram: DiagramPayload;
    systems: SystemCard[];
  };
  generatedAt: string;
  goals: string[];
  landing: { takeaways: string[] };
  meta: { baseline: string; subtitle: string; title: string };
  nonGoals: string[];
  openQuestions: string[];
  pains: string[];
  risks: string[];
  schemaVersion: 1;
  source: string;
};

class PayloadError extends Error {}

function readRecord(value: unknown, label: string): RawRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PayloadError(`${label} 必须是对象`);
  }
  return value as RawRecord;
}

function readString(parent: RawRecord, key: string, label: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PayloadError(`${label}.${key} 必须是非空字符串`);
  }
  return value;
}

function readStringArray(
  parent: RawRecord,
  key: string,
  label: string,
  min: number
): string[] {
  const value = parent[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PayloadError(`${label}.${key} 必须是字符串数组`);
  }
  if (value.length < min) {
    throw new PayloadError(`${label}.${key} 至少需要 ${min} 项`);
  }
  return value as string[];
}

const MERMAID_KIND_OK: Record<string, true> = {
  actor: true,
  agent: true,
  artifact: true,
  external: true,
  tool: true,
};

const MERMAID_TONE_OK: Record<string, true> = {
  danger: true,
  done: true,
  info: true,
  muted: true,
  success: true,
  warning: true,
};

function readDiagram(
  value: JsonValue | undefined,
  label: string
): DiagramPayload {
  const diagram = readRecord(value, label);
  const nodesValue = diagram.nodes;
  if (!Array.isArray(nodesValue) || nodesValue.length < 2) {
    throw new PayloadError(`${label}.nodes 至少需要 2 个节点`);
  }
  const nodes = nodesValue.map((node, index) => {
    const nodeLabel = `${label}.nodes[${index}]`;
    const record = readRecord(node, nodeLabel);
    const title = readString(record, "title", nodeLabel);
    const kind = record.kind;
    if (
      kind !== undefined &&
      (typeof kind !== "string" || !MERMAID_KIND_OK[kind])
    ) {
      throw new PayloadError(`${nodeLabel}.kind 非法：${String(kind)}`);
    }
    const tone = record.tone;
    if (
      tone !== undefined &&
      (typeof tone !== "string" || !MERMAID_TONE_OK[tone])
    ) {
      throw new PayloadError(`${nodeLabel}.tone 非法：${String(tone)}`);
    }
    const meta = record.meta;
    if (meta !== undefined && typeof meta !== "string") {
      throw new PayloadError(`${nodeLabel}.meta 必须是字符串`);
    }
    return {
      id: readString(record, "id", nodeLabel),
      ...(kind === undefined ? {} : { kind: kind as MermaidKind }),
      ...(meta === undefined ? {} : { meta }),
      title,
      ...(tone === undefined ? {} : { tone: tone as MermaidTone }),
    };
  });
  const edgesValue = diagram.edges;
  if (!Array.isArray(edgesValue)) {
    throw new PayloadError(`${label}.edges 必须是数组`);
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = edgesValue.map((edge, index) => {
    const edgeLabel = `${label}.edges[${index}]`;
    const record = readRecord(edge, edgeLabel);
    const labelField = record.label;
    if (labelField !== undefined && typeof labelField !== "string") {
      throw new PayloadError(`${edgeLabel}.label 必须是字符串`);
    }
    const source = readString(record, "source", edgeLabel);
    const target = readString(record, "target", edgeLabel);
    // Undeclared ids would make mermaid silently auto-create an
    // unlabeled default node — exactly the fabricated content this
    // module promises never to render.
    if (!nodeIds.has(source)) {
      throw new PayloadError(`${edgeLabel}.source 未声明节点 id：${source}`);
    }
    if (!nodeIds.has(target)) {
      throw new PayloadError(`${edgeLabel}.target 未声明节点 id：${target}`);
    }
    return {
      source,
      target,
      ...(labelField === undefined ? {} : { label: labelField }),
    };
  });
  return { edges, nodes };
}

const SYSTEM_ID_OK: Record<string, true> = {
  deepseek: true,
  herdr: true,
  pier: true,
  pi: true,
};

function readSystems(value: JsonValue | undefined): SystemCard[] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new PayloadError("design.systems 必须恰好 4 个系统");
  }
  return value.map((system, index) => {
    const label = `design.systems[${index}]`;
    const record = readRecord(system, label);
    const id = readString(record, "id", label);
    if (!SYSTEM_ID_OK[id]) {
      throw new PayloadError(`${label}.id 非法：${id}`);
    }
    return {
      api: readStringArray(record, "api", label, 3),
      diagram: readDiagram(record.diagram, `${label}.diagram`),
      distribution: readString(record, "distribution", label),
      domain: readString(record, "domain", label),
      evidence: readStringArray(record, "evidence", label, 3),
      id: id as SystemCard["id"],
      loading: readString(record, "loading", label),
      name: readString(record, "name", label),
      tagline: readString(record, "tagline", label),
      trust: readStringArray(record, "trust", label, 2),
      unit: readString(record, "unit", label),
    };
  });
}

function parseComparisonData(input: unknown): ComparisonData {
  const root = readRecord(input, "data.json");
  if (root.schemaVersion !== 1) {
    throw new PayloadError("data.json.schemaVersion 必须为 1");
  }
  const meta = readRecord(root.meta, "meta");
  const design = readRecord(root.design, "design");
  const landing = readRecord(root.landing, "landing");
  const alternativesValue = root.alternatives;
  if (!Array.isArray(alternativesValue) || alternativesValue.length === 0) {
    throw new PayloadError("alternatives 不能为空");
  }
  const alternatives = alternativesValue.map((alt, index) => {
    const record = readRecord(alt, `alternatives[${index}]`);
    return {
      name: readString(record, "name", `alternatives[${index}]`),
      rejectReason: readString(
        record,
        "rejectReason",
        `alternatives[${index}]`
      ),
    };
  });

  return {
    alternatives,
    bluf: readString(root, "bluf", "root"),
    context: readString(root, "context", "root"),
    design: {
      convergence: readStringArray(design, "convergence", "design", 3),
      dimensions: (() => {
        const rows = design.dimensions;
        if (!Array.isArray(rows) || rows.length < 8) {
          throw new PayloadError("design.dimensions 至少需要 8 行");
        }
        return rows.map((row, index) => {
          const record = readRecord(row, `design.dimensions[${index}]`);
          return {
            deepseek: readString(
              record,
              "deepseek",
              `design.dimensions[${index}]`
            ),
            dimension: readString(
              record,
              "dimension",
              `design.dimensions[${index}]`
            ),
            herdr: readString(record, "herdr", `design.dimensions[${index}]`),
            pi: readString(record, "pi", `design.dimensions[${index}]`),
            pier: readString(record, "pier", `design.dimensions[${index}]`),
          };
        });
      })(),
      divergence: readStringArray(design, "divergence", "design", 3),
      loopDiagram: readDiagram(design.loopDiagram, "design.loopDiagram"),
      systems: readSystems(design.systems),
    },
    generatedAt: readString(root, "generatedAt", "root"),
    goals: readStringArray(root, "goals", "root", 2),
    landing: { takeaways: readStringArray(landing, "takeaways", "landing", 2) },
    meta: {
      baseline: readString(meta, "baseline", "meta"),
      subtitle: readString(meta, "subtitle", "meta"),
      title: readString(meta, "title", "meta"),
    },
    nonGoals: readStringArray(root, "nonGoals", "root", 2),
    openQuestions: readStringArray(root, "openQuestions", "root", 0),
    pains: readStringArray(root, "pains", "root", 2),
    risks: readStringArray(root, "risks", "root", 0),
    schemaVersion: 1,
    source: readString(root, "source", "root"),
  };
}

let cached: ComparisonData | null = null;

/** Validated payload; throws a readable error when data.json is broken. */
function comparisonData(): ComparisonData {
  if (!cached) {
    try {
      cached = parseComparisonData(rawData);
    } catch (reason: unknown) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      throw new Error(
        `${detail}。下一步：修正相邻 data.json 后重新打开本画布。`
      );
    }
  }
  return cached;
}

export const data: ComparisonData = comparisonData();
