import { compileWorkflowEdges } from "./compile-edges.ts";
import {
  parkScreenFlowLabelAts,
  screenFlowLabelParkDiagnostics,
} from "./label.ts";
import { workflowEdgeRole } from "./role.ts";
import type {
  WorkflowDiagnostic,
  WorkflowEdge,
  WorkflowNodeLayout,
  WorkflowValidateReceipt,
} from "./types.ts";
import { WORKFLOW_ID_PATTERN } from "./types.ts";

export {
  SCREEN_FLOW_START_CHIP_GAP,
  SCREEN_FLOW_START_CHIP_H,
  screenFlowStartChipPosition,
  screenFlowStartChipSize,
} from "./start-chip.ts";

export type ScreenFlowEdge = WorkflowEdge;

export interface ScreenFlowSpec {
  readonly edges: readonly ScreenFlowEdge[];
  readonly mainPath?: readonly string[];
  readonly start?: string;
  readonly title: string;
}

export interface ScreenFlowBox {
  readonly h: number;
  readonly id: string;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

function error(
  code: string,
  message: string,
  subject: WorkflowDiagnostic["subject"],
  supportedFixes: readonly string[],
  evidence?: WorkflowDiagnostic["evidence"]
): WorkflowDiagnostic {
  return {
    code,
    evidence,
    message,
    severity: "error",
    subject,
    supportedFixes,
  };
}

export function screenFlowReferencedIds(
  spec: ScreenFlowSpec
): readonly string[] {
  const ids = new Set<string>();
  for (const edge of spec.edges) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  for (const id of spec.mainPath ?? []) {
    ids.add(id);
  }
  if (spec.start) {
    ids.add(spec.start);
  }
  return [...ids];
}

export function screenFlowStartId(spec: ScreenFlowSpec): string | undefined {
  if (spec.start) {
    return spec.start;
  }
  return spec.mainPath?.[0] ?? spec.edges[0]?.from;
}

export function artboardBoxAsNode(box: ScreenFlowBox): WorkflowNodeLayout {
  return {
    detail: "",
    h: box.h,
    id: box.id,
    kind: "step",
    label: box.id,
    tag: "",
    w: box.w,
    x: box.x,
    y: box.y,
  };
}

function uniqueEdgeIds(spec: ScreenFlowSpec): WorkflowDiagnostic[] {
  const seen = new Set<string>();
  const out: WorkflowDiagnostic[] = [];
  for (const [index, edge] of spec.edges.entries()) {
    const path = `/edges/${index}/id`;
    if (!WORKFLOW_ID_PATTERN.test(edge.id)) {
      out.push(
        error(
          "screen-flow/edge-id",
          `Edge id "${edge.id}" must match ${WORKFLOW_ID_PATTERN.source}.`,
          { edgeId: edge.id, path },
          ["Rename the edge to a letter-led id such as e-open."]
        )
      );
    }
    if (seen.has(edge.id)) {
      out.push(
        error(
          "screen-flow/edge-duplicate",
          `Edge id "${edge.id}" is used more than once.`,
          { edgeId: edge.id, path },
          ["Give this edge a unique id."]
        )
      );
    }
    seen.add(edge.id);
  }
  return out;
}

function checkId(
  id: string,
  path: string,
  kind: "artboard" | "start"
): WorkflowDiagnostic | undefined {
  if (WORKFLOW_ID_PATTERN.test(id)) {
    return;
  }
  return error(
    `screen-flow/${kind}-id`,
    `${kind} id "${id}" must match ${WORKFLOW_ID_PATTERN.source}.`,
    { path },
    ["Rename it to a letter-led id such as library."]
  );
}

export function validateScreenFlowSpec(
  spec: ScreenFlowSpec
): WorkflowValidateReceipt {
  const diagnostics: WorkflowDiagnostic[] = [];
  if (spec.title.trim() === "") {
    diagnostics.push(
      error(
        "screen-flow/title",
        "title must be a non-empty string.",
        { path: "/title" },
        ["Set title to the user journey, such as Upload an asset."]
      )
    );
  }
  if (spec.edges.length < 1) {
    diagnostics.push(
      error(
        "screen-flow/edges",
        "A screen flow needs at least one edge.",
        { path: "/edges" },
        ["Add an edge from the first screen to the next."]
      )
    );
  }
  diagnostics.push(...uniqueEdgeIds(spec));

  const unlabeled = new Map<string, string[]>();
  for (const [index, edge] of spec.edges.entries()) {
    const fromBad = checkId(edge.from, `/edges/${index}/from`, "artboard");
    const toBad = checkId(edge.to, `/edges/${index}/to`, "artboard");
    if (fromBad) {
      diagnostics.push(fromBad);
    }
    if (toBad) {
      diagnostics.push(toBad);
    }
    if (edge.label.trim() === "") {
      const key = `${edge.from}->${edge.to}:${workflowEdgeRole(edge.role)}`;
      const list = unlabeled.get(key) ?? [];
      list.push(edge.id);
      unlabeled.set(key, list);
    }
  }
  for (const [key, ids] of unlabeled) {
    if (ids.length < 2) {
      continue;
    }
    diagnostics.push(
      error(
        "screen-flow/parallel-unlabeled",
        `Edges ${ids.map((id) => `"${id}"`).join(" and ")} share ${key} without labels.`,
        { edgeId: ids[1], path: "/edges" },
        ["Give each parallel edge a short action label."]
      )
    );
  }

  if (spec.start) {
    const startBad = checkId(spec.start, "/start", "start");
    if (startBad) {
      diagnostics.push(startBad);
    }
    const endpoints = new Set<string>();
    for (const edge of spec.edges) {
      endpoints.add(edge.from);
      endpoints.add(edge.to);
    }
    for (const id of spec.mainPath ?? []) {
      endpoints.add(id);
    }
    if (WORKFLOW_ID_PATTERN.test(spec.start) && !endpoints.has(spec.start)) {
      diagnostics.push(
        error(
          "screen-flow/start-unknown",
          `start "${spec.start}" is not an endpoint on this path.`,
          { path: "/start" },
          ["Point start at an artboard id used by an edge or mainPath."]
        )
      );
    }
  }

  const path = spec.mainPath;
  if (path && path.length > 0) {
    if (path.length < 2) {
      diagnostics.push(
        error(
          "screen-flow/main-path-short",
          "mainPath needs at least two artboard ids.",
          { path: "/mainPath" },
          ["List the happy-path screens in order."]
        )
      );
    }
    for (const [index, id] of path.entries()) {
      const idBad = checkId(id, `/mainPath/${index}`, "artboard");
      if (idBad) {
        diagnostics.push(idBad);
      }
      const next = path[index + 1];
      if (!next) {
        continue;
      }
      const linked = spec.edges.some(
        (edge) => edge.from === id && edge.to === next
      );
      if (!linked) {
        diagnostics.push(
          error(
            "screen-flow/main-path-edge",
            `mainPath has no edge from "${id}" to "${next}".`,
            { path: `/mainPath/${index}` },
            [`Add an edge { from: "${id}", to: "${next}" } with a short label.`]
          )
        );
      }
    }
  }

  return {
    diagnostics,
    status: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}

export const SCREEN_FLOW_MIN_GUTTER = 120;
export const SCREEN_FLOW_CAPTION_STACK = 40;

function boxesOverlap(
  a: WorkflowNodeLayout,
  b: WorkflowNodeLayout,
  pad: number
): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

export function screenFlowPlacementDiagnostics(
  nodes: readonly WorkflowNodeLayout[]
): WorkflowDiagnostic[] {
  const out: WorkflowDiagnostic[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    if (!a) {
      continue;
    }
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      if (!b) {
        continue;
      }
      if (boxesOverlap(a, b, 8)) {
        out.push(
          error(
            "screen-flow/overlap",
            `Artboards "${a.id}" and "${b.id}" overlap.`,
            { nodeId: b.id, path: "/edges" },
            [`Move the Layer of "${b.id}" so it does not cover "${a.id}".`]
          )
        );
        continue;
      }
      const sameRow = Math.abs(a.y - b.y) < 48;
      const sameCol = Math.abs(a.x - b.x) < 48;
      if (sameRow) {
        const gap = a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
        const shown = Math.round(gap);
        if (gap >= 0 && shown < SCREEN_FLOW_MIN_GUTTER) {
          out.push(
            error(
              "screen-flow/tight-row",
              `Artboards "${a.id}" and "${b.id}" are only ${shown}px apart.`,
              { nodeId: b.id, path: "/edges" },
              [
                `Move the Layer of "${b.id}" at least ${SCREEN_FLOW_MIN_GUTTER}px from "${a.id}".`,
              ]
            )
          );
        }
      }
      if (sameCol) {
        const gap = a.y < b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
        const shown = Math.round(gap);
        if (gap >= 0 && shown < SCREEN_FLOW_MIN_GUTTER) {
          out.push(
            error(
              "screen-flow/tight-column",
              `Artboards "${a.id}" and "${b.id}" are only ${shown}px apart vertically.`,
              { nodeId: b.id, path: "/edges" },
              [
                `Move the Layer of "${b.id}" at least ${SCREEN_FLOW_MIN_GUTTER}px below "${a.id}".`,
              ]
            )
          );
        }
      }
    }
  }
  return out;
}

export function rewriteScreenFlowFixes(
  diagnostics: readonly WorkflowDiagnostic[]
): WorkflowDiagnostic[] {
  return diagnostics.map((item) => {
    if (!item.code.startsWith("workflow/")) {
      return item;
    }
    const raw = item.subject.nodeId;
    const target = raw?.startsWith("cap_") ? raw.slice(4) : raw;
    return {
      ...item,
      supportedFixes: [
        target
          ? `Move the Layer of "${target}" so the frames leave a wider gap.`
          : "Move the Layers on this hop so the frames leave a wider gap.",
      ],
    };
  });
}

export function screenFlowMissingArtboards(
  spec: ScreenFlowSpec,
  mountedIds: ReadonlySet<string>
): WorkflowDiagnostic[] {
  const out: WorkflowDiagnostic[] = [];
  for (const id of screenFlowReferencedIds(spec)) {
    if (mountedIds.has(id)) {
      continue;
    }
    out.push(
      error(
        "screen-flow/missing-artboard",
        `Artboard "${id}" is on the path but is not mounted.`,
        { nodeId: id, path: "/edges" },
        [`Give an Artboard id="${id}" on this WorldStage.`]
      )
    );
  }
  return out;
}

/**
 * Compile errors that Empty the overlay. Quality codes (short last
 * segment, label drift, stacked verticals) are not Empty — spec §9.
 */
export function screenFlowCrossingErrors(
  diagnostics: readonly WorkflowDiagnostic[]
): WorkflowDiagnostic[] {
  return rewriteScreenFlowFixes(
    diagnostics.filter((item) => item.code === "workflow/edge-crosses-node")
  );
}

/**
 * Author-time paint gate: structure + gutters + through-box + unparkable labels.
 * `frames` are `[data-slot="artboard-frame"]` boxes (not the caption).
 * Apply only the first `supportedFixes` entry, then call again.
 */
export function validateScreenFlowPaint(input: {
  frames: readonly ScreenFlowBox[];
  spec: ScreenFlowSpec;
}): WorkflowValidateReceipt {
  const structure = validateScreenFlowSpec(input.spec);
  if (structure.status === 1) {
    return structure;
  }
  const diagnostics: WorkflowDiagnostic[] = [];
  const mounted = new Set(input.frames.map((box) => box.id));
  diagnostics.push(...screenFlowMissingArtboards(input.spec, mounted));
  const frames = input.frames.map((box) => artboardBoxAsNode(box));
  diagnostics.push(...screenFlowPlacementDiagnostics(frames));
  const captions = input.frames.map((box) =>
    artboardBoxAsNode({
      h: SCREEN_FLOW_CAPTION_STACK - 10,
      id: `cap_${box.id}`,
      w: box.w,
      x: box.x,
      y: box.y - SCREEN_FLOW_CAPTION_STACK,
    })
  );
  const width = Math.max(1, ...frames.map((box) => box.x + box.w));
  const compiled = compileWorkflowEdges({
    edges: input.spec.edges,
    groups: [],
    lanes: [],
    nodes: [...frames, ...captions],
    width,
    ...(input.spec.mainPath === undefined
      ? {}
      : { mainPath: input.spec.mainPath }),
  });
  const nodes = [...frames, ...captions];
  const parked = parkScreenFlowLabelAts(compiled.edges, nodes);
  diagnostics.push(
    ...screenFlowCrossingErrors(compiled.diagnostics),
    ...screenFlowLabelParkDiagnostics(parked, nodes)
  );
  return {
    diagnostics,
    status: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}
