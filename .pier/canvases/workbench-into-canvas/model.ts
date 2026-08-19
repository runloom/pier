const ROOT_KEYS = ["schemaVersion", "generatedAt", "source", "data"] as const;

const DATA_KEYS = [
  "meta",
  "bluf",
  "insight",
  "decision",
  "goals",
  "nonGoals",
  "overviewCards",
  "mainLoop",
  "problem",
  "currentState",
  "architecture",
  "families",
  "layers",
  "productFrames",
  "alternatives",
  "milestones",
  "delivery",
  "acceptance",
  "risks",
  "knownDebt",
] as const;

const META_KEYS = [
  "title",
  "subtitle",
  "status",
  "version",
  "researchCutoff",
  "codeBaseline",
] as const;

const FORBIDDEN_ADOPTED_PHRASES = [
  "canvas-catalog.json",
  "pier.canvas.materials.declare",
  ".pier/canvas-catalog",
  "kit.canvas.tsx",
  "在面板中打开",
  "Kit 面板",
] as const;

const FAMILY_IDS = [
  "layout",
  "control",
  "viz",
  "data",
  "file",
  "page",
] as const;
const FRAME_IDS = ["K1", "K2", "K3"] as const;
const MILESTONE_IDS = ["P0", "P1", "P2", "P3"] as const;

type TextRow<K extends string> = { [P in K]: string };

const DIAGRAM_DIRECTIONS = ["left-to-right", "top-to-bottom"] as const;
const DIAGRAM_TONES = [
  "danger",
  "done",
  "info",
  "muted",
  "success",
  "warning",
] as const;
const DIAGRAM_KINDS = [
  "actor",
  "agent",
  "artifact",
  "external",
  "tool",
] as const;

export type CanvasDiagramNode = {
  id: string;
  kind?: (typeof DIAGRAM_KINDS)[number];
  meta?: string;
  title: string;
  tone?: (typeof DIAGRAM_TONES)[number];
};

export type CanvasDiagramEdge = {
  label?: string;
  source: string;
  target: string;
};

export type CanvasDiagram = {
  direction: (typeof DIAGRAM_DIRECTIONS)[number];
  edges: CanvasDiagramEdge[];
  nodes: CanvasDiagramNode[];
};

export type Family = TextRow<"id" | "title" | "source" | "v1" | "excluded"> & {
  items: string[];
};

export type SchemeData = {
  schemaVersion: 2;
  generatedAt: string;
  source: string;
  data: {
    meta: TextRow<(typeof META_KEYS)[number]>;
    bluf: string;
    insight: string;
    decision: string;
    goals: string[];
    nonGoals: string[];
    overviewCards: TextRow<"id" | "badge" | "title" | "body">[];
    mainLoop: { caption: string; diagram: CanvasDiagram };
    problem: {
      title: string;
      thesis: string;
      pains: TextRow<"id" | "title" | "detail" | "consequence">[];
    };
    currentState: TextRow<"area" | "now" | "missing">[];
    architecture: { diagram: CanvasDiagram; notes: string[] };
    families: Family[];
    layers: TextRow<"layer" | "owner" | "owns" | "mustNotOwn">[];
    productFrames: TextRow<"id" | "name" | "spec">[];
    alternatives: TextRow<"name" | "disposition" | "reason">[];
    milestones: TextRow<"id" | "title" | "deliver">[];
    delivery: { caption: string; diagram: CanvasDiagram };
    acceptance: TextRow<"id" | "text" | "evidence" | "status">[];
    risks: TextRow<"id" | "text" | "mitigation">[];
    knownDebt: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} 含未知字段：${unexpected.join("、")}`);
  }
  const missing = keys.filter((key) => !(key in record));
  if (missing.length > 0) {
    throw new Error(`${label} 缺少字段：${missing.join("、")}`);
  }
}

function requireString(record: Record<string, unknown>, key: string, label: string) {
  if (typeof record[key] !== "string" || record[key] === "") {
    throw new Error(`${label}.${key} 必须是非空字符串`);
  }
}

function requireStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
  return value;
}

function requireExactStringRecord<K extends string>(
  value: unknown,
  keys: readonly K[],
  label: string,
): TextRow<K> {
  const record = requireRecord(value, label);
  requireExactKeys(record, keys, label);
  for (const key of keys) {
    requireString(record, key, label);
  }
  return record as TextRow<K>;
}

function requireRows<K extends string>(
  value: unknown,
  keys: readonly K[],
  label: string,
): TextRow<K>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} 必须是非空数组`);
  }
  return value.map((item, index) =>
    requireExactStringRecord(item, keys, `${label}[${index}]`),
  );
}

function requireIds(
  rows: Array<{ id: string }>,
  expected: readonly string[],
  label: string,
) {
  const ids = rows.map((row) => row.id);
  if (ids.length !== expected.length || expected.some((id, index) => ids[index] !== id)) {
    throw new Error(`${label} 必须按序为 ${expected.join("、")}`);
  }
}

function requireDiagram(value: unknown, label: string): CanvasDiagram {
  const record = requireRecord(value, label);
  requireExactKeys(record, ["direction", "nodes", "edges"], label);
  const direction = DIAGRAM_DIRECTIONS.find(
    (item) => item === record.direction,
  );
  if (!direction) {
    throw new Error(`${label}.direction 必须是 left-to-right 或 top-to-bottom`);
  }
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
    throw new Error(`${label}.nodes 必须是非空数组`);
  }
  if (!Array.isArray(record.edges)) {
    throw new Error(`${label}.edges 必须是数组`);
  }
  const nodes = record.nodes.map((item, index) =>
    parseDiagramNode(item, `${label}.nodes[${index}]`),
  );
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) {
    throw new Error(`${label}.nodes id 必须唯一`);
  }
  const edges = record.edges.map((item, index) =>
    parseDiagramEdge(item, ids, `${label}.edges[${index}]`),
  );
  return { direction, edges, nodes };
}

function parseDiagramNode(value: unknown, label: string): CanvasDiagramNode {
  const record = requireRecord(value, label);
  const allowed = ["id", "title", "meta", "kind", "tone"];
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} 含未知字段：${unexpected.join("、")}`);
  }
  requireString(record, "id", label);
  requireString(record, "title", label);
  let meta: string | undefined;
  if ("meta" in record) {
    if (typeof record.meta !== "string" || record.meta === "") {
      throw new Error(`${label}.meta 必须是非空字符串`);
    }
    meta = record.meta;
  }
  let kind: CanvasDiagramNode["kind"];
  if ("kind" in record) {
    if (
      typeof record.kind !== "string" ||
      !DIAGRAM_KINDS.some((item) => item === record.kind)
    ) {
      throw new Error(`${label}.kind 非法`);
    }
    kind = record.kind as CanvasDiagramNode["kind"];
  }
  let tone: CanvasDiagramNode["tone"];
  if ("tone" in record) {
    if (
      typeof record.tone !== "string" ||
      !DIAGRAM_TONES.some((item) => item === record.tone)
    ) {
      throw new Error(`${label}.tone 非法`);
    }
    tone = record.tone as CanvasDiagramNode["tone"];
  }
  return {
    id: record.id as string,
    title: record.title as string,
    ...(kind ? { kind } : {}),
    ...(meta ? { meta } : {}),
    ...(tone ? { tone } : {}),
  };
}

function parseDiagramEdge(
  value: unknown,
  ids: Set<string>,
  label: string,
): CanvasDiagramEdge {
  const record = requireRecord(value, label);
  const allowed = ["source", "target", "label"];
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} 含未知字段：${unexpected.join("、")}`);
  }
  requireString(record, "source", label);
  requireString(record, "target", label);
  const source = record.source as string;
  const target = record.target as string;
  if (!ids.has(source) || !ids.has(target)) {
    throw new Error(`${label} 必须指向已有节点`);
  }
  if ("label" in record) {
    if (typeof record.label !== "string" || record.label === "") {
      throw new Error(`${label}.label 必须是非空字符串`);
    }
    return { label: record.label, source, target };
  }
  return { source, target };
}

function diagramPlainText(diagram: CanvasDiagram): string {
  return [
    ...diagram.nodes.flatMap((node) => [node.id, node.title, node.meta ?? ""]),
    ...diagram.edges.flatMap((edge) => [
      edge.source,
      edge.target,
      edge.label ?? "",
    ]),
  ].join("\n");
}

function assertMainLoopSplit(diagram: CanvasDiagram) {
  const discover = new Set(
    diagram.nodes.filter((node) => node.meta === "看见").map((node) => node.id),
  );
  const author = new Set(
    diagram.nodes.filter((node) => node.meta === "生成").map((node) => node.id),
  );
  const groups = new Set(
    diagram.nodes
      .map((node) => node.meta)
      .filter((meta): meta is string => Boolean(meta)),
  );
  if (
    groups.size !== 2 ||
    !groups.has("看见") ||
    !groups.has("生成") ||
    discover.size === 0 ||
    author.size === 0
  ) {
    throw new Error("主回路必须恰好看见与生成两个分组");
  }
  for (const edge of diagram.edges) {
    if (
      (discover.has(edge.source) && author.has(edge.target)) ||
      (author.has(edge.source) && discover.has(edge.target))
    ) {
      throw new Error("主回路看见与生成不得相连");
    }
  }
}

function collectAdoptedText(data: SchemeData["data"]): string {
  const familyText = data.families
    .map((family) =>
      [family.title, family.source, family.v1, family.excluded, ...family.items].join("\n"),
    )
    .join("\n");
  return [
    data.bluf,
    data.insight,
    data.decision,
    ...data.goals,
    ...data.overviewCards.map((card) => `${card.title}\n${card.body}`),
    diagramPlainText(data.mainLoop.diagram),
    data.mainLoop.caption,
    diagramPlainText(data.delivery.diagram),
    data.delivery.caption,
    ...data.productFrames.map((frame) => `${frame.name}\n${frame.spec}`),
    ...data.milestones.map((step) => step.deliver),
    ...data.acceptance.map((row) => `${row.text}\n${row.evidence}`),
    familyText,
    ...data.architecture.notes,
  ].join("\n");
}

function assertAdoptedPath(data: SchemeData["data"]) {
  const adopted = collectAdoptedText(data);
  for (const phrase of FORBIDDEN_ADOPTED_PHRASES) {
    if (adopted.includes(phrase)) {
      throw new Error(`采纳路径出现禁止的登记产品：${phrase}`);
    }
  }
  const adopt = data.alternatives.filter((row) => row.disposition === "adopt");
  if (adopt.length !== 1) {
    throw new Error("alternatives 必须恰好一条 disposition=adopt");
  }
  const adoptText = `${adopt[0]?.name ?? ""}\n${adopt[0]?.reason ?? ""}`;
  for (const phrase of FORBIDDEN_ADOPTED_PHRASES) {
    if (adoptText.includes(phrase)) {
      throw new Error(`采纳项出现禁止的登记产品：${phrase}`);
    }
  }
  if (!data.bluf.includes("设置")) {
    throw new Error("bluf 必须点明设置发现面");
  }
  if (!data.bluf.includes("项目")) {
    throw new Error("bluf 必须点明设置→项目");
  }
  if (!data.bluf.includes("列表")) {
    throw new Error("bluf 必须点明一个列表");
  }
  if (!data.knownDebt.some((item) => item.includes("workbench-into-canvas"))) {
    throw new Error("knownDebt 必须记录目录名与标题不一致");
  }
}

function parseFamily(value: unknown, label: string): Family {
  const record = requireRecord(value, label);
  requireExactKeys(
    record,
    ["id", "title", "source", "v1", "items", "excluded"],
    label,
  );
  requireString(record, "id", label);
  requireString(record, "title", label);
  requireString(record, "source", label);
  requireString(record, "v1", label);
  requireString(record, "excluded", label);
  const items = requireStringArray(record.items, `${label}.items`);
  return {
    id: record.id as string,
    title: record.title as string,
    source: record.source as string,
    v1: record.v1 as string,
    excluded: record.excluded as string,
    items,
  };
}

export function parseScheme(raw: string): SchemeData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("data.json 不是合法 JSON");
  }
  const root = requireRecord(parsed, "data.json");
  requireExactKeys(root, ROOT_KEYS, "data.json");
  if (root.schemaVersion !== 2) {
    throw new Error("schemaVersion 必须是 2");
  }
  requireString(root, "generatedAt", "data.json");
  requireString(root, "source", "data.json");

  const data = requireRecord(root.data, "data");
  requireExactKeys(data, DATA_KEYS, "data");
  requireString(data, "bluf", "data");
  requireString(data, "insight", "data");
  requireString(data, "decision", "data");
  const meta = requireExactStringRecord(data.meta, META_KEYS, "data.meta");
  const goals = requireStringArray(data.goals, "data.goals");
  const nonGoals = requireStringArray(data.nonGoals, "data.nonGoals");
  const overviewCards = requireRows(
    data.overviewCards,
    ["id", "badge", "title", "body"],
    "data.overviewCards",
  );
  requireIds(overviewCards, ["problem", "design", "landing"], "data.overviewCards");
  const mainLoopRecord = requireRecord(data.mainLoop, "data.mainLoop");
  requireExactKeys(mainLoopRecord, ["diagram", "caption"], "data.mainLoop");
  requireString(mainLoopRecord, "caption", "data.mainLoop");
  const mainLoop = {
    caption: mainLoopRecord.caption as string,
    diagram: requireDiagram(mainLoopRecord.diagram, "data.mainLoop.diagram"),
  };
  assertMainLoopSplit(mainLoop.diagram);

  const problem = requireRecord(data.problem, "data.problem");
  requireExactKeys(problem, ["title", "thesis", "pains"], "data.problem");
  requireString(problem, "title", "data.problem");
  requireString(problem, "thesis", "data.problem");
  const pains = requireRows(
    problem.pains,
    ["id", "title", "detail", "consequence"],
    "data.problem.pains",
  );
  if (pains.length < 3) {
    throw new Error("data.problem.pains 至少三条");
  }

  const currentState = requireRows(
    data.currentState,
    ["area", "now", "missing"],
    "data.currentState",
  );
  const architecture = requireRecord(data.architecture, "data.architecture");
  requireExactKeys(architecture, ["diagram", "notes"], "data.architecture");
  const architectureDiagram = requireDiagram(
    architecture.diagram,
    "data.architecture.diagram",
  );
  const architectureNotes = requireStringArray(
    architecture.notes,
    "data.architecture.notes",
  );

  if (!Array.isArray(data.families) || data.families.length !== 6) {
    throw new Error("data.families 必须是六类型");
  }
  const families = data.families.map((item, index) =>
    parseFamily(item, `data.families[${index}]`),
  );
  requireIds(families, FAMILY_IDS, "data.families");

  const layers = requireRows(
    data.layers,
    ["layer", "owner", "owns", "mustNotOwn"],
    "data.layers",
  );
  const productFrames = requireRows(
    data.productFrames,
    ["id", "name", "spec"],
    "data.productFrames",
  );
  requireIds(productFrames, FRAME_IDS, "data.productFrames");
  const alternatives = requireRows(
    data.alternatives,
    ["name", "disposition", "reason"],
    "data.alternatives",
  );
  for (const row of alternatives) {
    if (row.disposition !== "reject" && row.disposition !== "adopt") {
      throw new Error("alternatives.disposition 只能是 reject 或 adopt");
    }
  }
  const milestones = requireRows(
    data.milestones,
    ["id", "title", "deliver"],
    "data.milestones",
  );
  requireIds(milestones, MILESTONE_IDS, "data.milestones");
  const deliveryRecord = requireRecord(data.delivery, "data.delivery");
  requireExactKeys(deliveryRecord, ["diagram", "caption"], "data.delivery");
  requireString(deliveryRecord, "caption", "data.delivery");
  const delivery = {
    caption: deliveryRecord.caption as string,
    diagram: requireDiagram(deliveryRecord.diagram, "data.delivery.diagram"),
  };
  const acceptance = requireRows(
    data.acceptance,
    ["id", "text", "evidence", "status"],
    "data.acceptance",
  );
  const risks = requireRows(
    data.risks,
    ["id", "text", "mitigation"],
    "data.risks",
  );
  const knownDebt = requireStringArray(data.knownDebt, "data.knownDebt");

  const scheme: SchemeData = {
    schemaVersion: 2,
    generatedAt: root.generatedAt as string,
    source: root.source as string,
    data: {
      meta,
      bluf: data.bluf as string,
      insight: data.insight as string,
      decision: data.decision as string,
      goals,
      nonGoals,
      overviewCards,
      mainLoop,
      problem: {
        title: problem.title as string,
        thesis: problem.thesis as string,
        pains,
      },
      currentState,
      architecture: {
        diagram: architectureDiagram,
        notes: architectureNotes,
      },
      families,
      layers,
      productFrames,
      alternatives,
      milestones,
      delivery,
      acceptance,
      risks,
      knownDebt,
    },
  };
  assertAdoptedPath(scheme.data);
  return scheme;
}

export const CANVAS_MATERIALS_FORBIDDEN_ADOPTED_PHRASES = FORBIDDEN_ADOPTED_PHRASES;
export const CANVAS_MATERIALS_FAMILY_IDS = FAMILY_IDS;
export const CANVAS_MATERIALS_FRAME_IDS = FRAME_IDS;
