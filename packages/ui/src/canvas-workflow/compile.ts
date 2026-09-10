import { compileWorkflowEdges } from "./compile-edges.ts";
import { placeWorkflowFrames, workflowBoardChrome } from "./frame.ts";
import { workflowLegendItems } from "./kind.ts";
import type {
  WorkflowLayout,
  WorkflowNodeLayout,
  WorkflowPoint,
  WorkflowSpec,
} from "./types.ts";

function edgeBottomY(
  nodes: readonly WorkflowNodeLayout[],
  edges: readonly { points: readonly WorkflowPoint[] }[]
): number {
  return Math.max(
    0,
    ...nodes.map((node) => node.y + node.h),
    ...edges.flatMap((edge) => edge.points.map((point) => point.y))
  );
}

export function compileWorkflowLayout(spec: WorkflowSpec): WorkflowLayout {
  const frames = placeWorkflowFrames(spec);
  const { groups, lanes, nodes, phases, width } = frames;
  const compiled = compileWorkflowEdges({
    edges: spec.edges,
    groups,
    lanes,
    mainPath: spec.mainPath,
    nodes,
    width,
  });
  const lastLane = lanes.at(-1);
  const legend = workflowLegendItems(nodes);
  const chrome = workflowBoardChrome(
    lastLane ? lastLane.y + lastLane.h : 0,
    edgeBottomY(nodes, compiled.edges),
    legend.length,
    spec.notes?.length ?? 0
  );
  return {
    diagnostics: compiled.diagnostics,
    edges: compiled.edges,
    groups,
    height: chrome.height,
    lanes,
    legend,
    legendY: chrome.legendY,
    nodes,
    notes: spec.notes ?? [],
    notesY: chrome.notesY,
    phases,
    title: spec.title,
    width,
  };
}
