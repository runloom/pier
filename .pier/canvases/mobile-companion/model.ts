import rawData from "./data.json";

/**
 * Adjacent payload access. Live-modules fence allows only react / react-dom /
 * pier/canvas / pier/host in canvas modules — keep this file free of Node.
 */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type RawRecord = { [key: string]: JsonValue | undefined };

export type MermaidKind = "actor" | "agent" | "artifact" | "external" | "tool";

export type MermaidNode = {
  id: string;
  kind: MermaidKind;
  meta?: string;
  title: string;
};

export type MermaidEdge = {
  label?: string;
  source: string;
  target: string;
};

export type Wireframe = {
  description: string;
  height?: number;
  id: string;
  title: string;
  width?: number;
};

export type CoreLoopRow = {
  broken: string;
  sense: string;
  step: string;
};

export type Milestone = {
  deliver: string;
  id: string;
  kind: string;
  title: string;
};

export type CompanionData = {
  acceptance: string[];
  alternatives: Array<{ name: string; rejectReason: string }>;
  bluf: string;
  context: string;
  coreLoop: CoreLoopRow[];
  design: {
    journeyDiagram: { edges: MermaidEdge[]; nodes: MermaidNode[] };
    layers: string[];
    loopDiagram: { edges: MermaidEdge[]; nodes: MermaidNode[] };
    connectSequence: string;
  };
  generatedAt: string;
  goals: string[];
  landingLead: string;
  meta: { baseline: string; subtitle: string; title: string };
  milestones: Milestone[];
  nonGoals: string[];
  openQuestions: string[];
  pains: string[];
  risks: string[];
  schemaVersion: 1;
  source: string;
  wireframes: Wireframe[];
};

class PayloadError extends Error {}

function record(value: unknown, label: string): RawRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PayloadError(`${label} 必须是对象`);
  }
  return value as RawRecord;
}

function str(parent: RawRecord, key: string, label: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PayloadError(`${label}.${key} 必须是非空字符串`);
  }
  return value;
}

function strs(
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

const KIND_OK = {
  actor: true,
  agent: true,
  artifact: true,
  external: true,
  tool: true,
} as const;

function isMermaidKind(value: unknown): value is MermaidKind {
  return typeof value === "string" && value in KIND_OK;
}

function optPx(
  parent: RawRecord,
  key: string,
  label: string
): number | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 320) {
    throw new PayloadError(`${label}.${key} 必须是 ≥320 的整数`);
  }
  return value;
}

function parseGraph(
  parent: RawRecord,
  key: string
): { edges: MermaidEdge[]; nodes: MermaidNode[] } {
  const diagram = record(parent[key], key);
  const nodesValue = diagram.nodes;
  if (!Array.isArray(nodesValue) || nodesValue.length < 2) {
    throw new PayloadError(`${key}.nodes 至少 2 个`);
  }
  const nodes = nodesValue.map((node, index) => {
    const label = `${key}.nodes[${index}]`;
    const rec = record(node, label);
    const kind = rec.kind;
    if (!isMermaidKind(kind)) {
      throw new PayloadError(`${label}.kind 必须是 mermaid 节点类型`);
    }
    const metaField = rec.meta;
    return {
      id: str(rec, "id", label),
      kind,
      title: str(rec, "title", label),
      ...(typeof metaField === "string" ? { meta: metaField } : {}),
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const edgesValue = diagram.edges;
  if (!Array.isArray(edgesValue)) {
    throw new PayloadError(`${key}.edges 必须是数组`);
  }
  const edges = edgesValue.map((edge, index) => {
    const label = `${key}.edges[${index}]`;
    const rec = record(edge, label);
    const source = str(rec, "source", label);
    const target = str(rec, "target", label);
    if (!(ids.has(source) && ids.has(target))) {
      throw new PayloadError(`${label} 引用了未声明节点`);
    }
    const edgeLabel = rec.label;
    return {
      source,
      target,
      ...(typeof edgeLabel === "string" ? { label: edgeLabel } : {}),
    };
  });
  return { edges, nodes };
}

const WIRE_IDS = ["QR", "H0", "H1", "H2", "S1", "S2", "S3", "N1"] as const;

function parse(input: unknown): CompanionData {
  const root = record(input, "data.json");
  if (root.schemaVersion !== 1) {
    throw new PayloadError("schemaVersion 必须为 1");
  }
  const meta = record(root.meta, "meta");
  const design = record(root.design, "design");
  const loopDiagram = parseGraph(design, "loopDiagram");
  const journeyDiagram = parseGraph(design, "journeyDiagram");
  const connectSequence = str(design, "connectSequence", "design");
  if (!connectSequence.startsWith("sequenceDiagram")) {
    throw new PayloadError("connectSequence 必须是 sequenceDiagram");
  }

  const altValue = root.alternatives;
  if (!Array.isArray(altValue) || altValue.length === 0) {
    throw new PayloadError("alternatives 不能为空");
  }
  const alternatives = altValue.map((item, index) => {
    const rec = record(item, `alternatives[${index}]`);
    return {
      name: str(rec, "name", `alternatives[${index}]`),
      rejectReason: str(rec, "rejectReason", `alternatives[${index}]`),
    };
  });

  const mileValue = root.milestones;
  if (!Array.isArray(mileValue) || mileValue.length === 0) {
    throw new PayloadError("milestones 不能为空");
  }
  const milestones = mileValue.map((item, index) => {
    const rec = record(item, `milestones[${index}]`);
    return {
      deliver: str(rec, "deliver", `milestones[${index}]`),
      id: str(rec, "id", `milestones[${index}]`),
      kind: str(rec, "kind", `milestones[${index}]`),
      title: str(rec, "title", `milestones[${index}]`),
    };
  });

  const loopValue = root.coreLoop;
  if (!Array.isArray(loopValue) || loopValue.length !== 6) {
    throw new PayloadError("coreLoop 必须恰好覆盖六条闭环");
  }
  const coreLoop = loopValue.map((item, index) => {
    const rec = record(item, `coreLoop[${index}]`);
    return {
      broken: str(rec, "broken", `coreLoop[${index}]`),
      sense: str(rec, "sense", `coreLoop[${index}]`),
      step: str(rec, "step", `coreLoop[${index}]`),
    };
  });

  const wireValue = root.wireframes;
  if (!Array.isArray(wireValue) || wireValue.length !== WIRE_IDS.length) {
    throw new PayloadError(`wireframes 必须恰好 ${WIRE_IDS.length} 面`);
  }
  const wireframes = wireValue.map((item, index) => {
    const rec = record(item, `wireframes[${index}]`);
    const id = str(rec, "id", `wireframes[${index}]`);
    if (id !== WIRE_IDS[index]) {
      throw new PayloadError(`wireframes[${index}].id 必须是 ${WIRE_IDS[index]}`);
    }
    const height = optPx(rec, "height", `wireframes[${index}]`);
    const width = optPx(rec, "width", `wireframes[${index}]`);
    return {
      description: str(rec, "description", `wireframes[${index}]`),
      id,
      title: str(rec, "title", `wireframes[${index}]`),
      ...(height === undefined ? {} : { height }),
      ...(width === undefined ? {} : { width }),
    };
  });

  const bluf = str(root, "bluf", "root");
  if (bluf.length > 280) {
    throw new PayloadError("bluf 过长（门禁 has-bluf）");
  }

  return {
    acceptance: strs(root, "acceptance", "root", 3),
    alternatives,
    bluf,
    context: str(root, "context", "root"),
    coreLoop,
    design: {
      journeyDiagram,
      layers: strs(design, "layers", "design", 4),
      loopDiagram,
      connectSequence,
    },
    generatedAt: str(root, "generatedAt", "root"),
    goals: strs(root, "goals", "root", 2),
    landingLead: str(root, "landingLead", "root"),
    meta: {
      baseline: str(meta, "baseline", "meta"),
      subtitle: str(meta, "subtitle", "meta"),
      title: str(meta, "title", "meta"),
    },
    milestones,
    nonGoals: strs(root, "nonGoals", "root", 2),
    openQuestions: strs(root, "openQuestions", "root", 0),
    pains: strs(root, "pains", "root", 2),
    risks: strs(root, "risks", "root", 0),
    schemaVersion: 1,
    source: str(root, "source", "root"),
    wireframes,
  };
}

let cached: CompanionData | null = null;

function load(): CompanionData {
  if (!cached) {
    try {
      cached = parse(rawData);
    } catch (reason: unknown) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      throw new Error(
        `${detail}。下一步：修正相邻 data.json 后重新打开本画布。`
      );
    }
  }
  return cached;
}

export const WIREFRAME_IDS: readonly string[] = WIRE_IDS;
export const data: CompanionData = load();
