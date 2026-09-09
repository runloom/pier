import { workflowNodeHeight, workflowNodeKind } from "./kind.ts";
import {
  WORKFLOW_ARROW_SIZE,
  WORKFLOW_COL_GAP,
  WORKFLOW_GROUP_BOTTOM,
  WORKFLOW_GROUP_PAD,
  WORKFLOW_GROUP_STRIP,
  WORKFLOW_LABEL_CLEAR,
  WORKFLOW_LANE_GAP,
  WORKFLOW_LANE_GUTTER,
  WORKFLOW_LANE_INSET,
  WORKFLOW_LANE_STRIP,
  WORKFLOW_LEGEND_H,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  WORKFLOW_NOTES_H,
  WORKFLOW_PAD,
  WORKFLOW_TITLE_H,
  workflowLabelWidth,
} from "./metrics.ts";
import type {
  WorkflowGroupLayout,
  WorkflowLaneLayout,
  WorkflowNode,
  WorkflowNodeLayout,
  WorkflowPhaseLayout,
  WorkflowSpec,
} from "./types.ts";

function laneHasGroup(spec: WorkflowSpec, laneId: string): boolean {
  return (spec.groups ?? []).some((group) => group.lane === laneId);
}

function nodeInGroup(spec: WorkflowSpec, node: WorkflowNode): boolean {
  return (spec.groups ?? []).some(
    (group) =>
      group.lane === node.lane &&
      node.col >= group.fromCol &&
      node.col <= group.toCol
  );
}

export function workflowColumnGaps(
  spec: WorkflowSpec,
  colCount: number
): number[] {
  const gaps = Array.from(
    { length: Math.max(0, colCount - 1) },
    () => WORKFLOW_COL_GAP
  );
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  for (const edge of spec.edges) {
    if (edge.label.trim() === "") {
      continue;
    }
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!(from && to) || from.lane !== to.lane) {
      continue;
    }
    const left = Math.min(from.col, to.col);
    const right = Math.max(from.col, to.col);
    if (right !== left + 1) {
      continue;
    }
    const current = gaps[left];
    if (current === undefined) {
      continue;
    }
    gaps[left] = Math.max(
      current,
      workflowLabelWidth(edge.label) +
        WORKFLOW_ARROW_SIZE +
        WORKFLOW_LABEL_CLEAR
    );
  }
  return gaps;
}

function columnLeft(col: number, gaps: readonly number[]): number {
  let x = WORKFLOW_LANE_GUTTER;
  for (let index = 0; index < col; index += 1) {
    x += WORKFLOW_NODE_WIDTH + (gaps[index] ?? WORKFLOW_COL_GAP);
  }
  return x;
}

export function placeWorkflowFrames(spec: WorkflowSpec): {
  groups: WorkflowGroupLayout[];
  lanes: WorkflowLaneLayout[];
  nodes: WorkflowNodeLayout[];
  phases: WorkflowPhaseLayout[];
  width: number;
} {
  const colCount = Math.max(
    1,
    ...spec.nodes.map((node) => node.col + 1),
    ...(spec.phases ?? []).map((phase) => phase.toCol + 1),
    ...(spec.groups ?? []).map((group) => group.toCol + 1)
  );
  const gaps = workflowColumnGaps(spec, colCount);
  const gapSum = gaps.reduce((sum, gap) => sum + gap, 0);
  const innerW =
    WORKFLOW_LANE_INSET * 2 + colCount * WORKFLOW_NODE_WIDTH + gapSum;
  const width = WORKFLOW_PAD * 2 + innerW;
  const laneTop = WORKFLOW_PAD + WORKFLOW_TITLE_H + 8;
  const laneIndex = new Map(spec.lanes.map((lane, index) => [lane.id, index]));
  const laneNodeH = spec.lanes.map((lane) => {
    const heights = spec.nodes
      .filter((node) => node.lane === lane.id)
      .map(workflowNodeHeight);
    return Math.max(WORKFLOW_NODE_HEIGHT, ...heights);
  });
  const laneExtra = spec.lanes.map((lane) =>
    laneHasGroup(spec, lane.id)
      ? WORKFLOW_GROUP_STRIP + WORKFLOW_GROUP_BOTTOM
      : 0
  );
  const laneH = (row: number) =>
    WORKFLOW_LANE_STRIP +
    WORKFLOW_LANE_INSET * 2 +
    (laneExtra[row] ?? 0) +
    (laneNodeH[row] ?? WORKFLOW_NODE_HEIGHT);
  const lanes: WorkflowLaneLayout[] = spec.lanes.map((lane, row) => {
    let y = laneTop;
    for (let index = 0; index < row; index += 1) {
      y += laneH(index) + WORKFLOW_LANE_GAP;
    }
    return {
      h: laneH(row),
      id: lane.id,
      label: lane.label,
      variant: lane.variant ?? "default",
      w: innerW,
      x: WORKFLOW_PAD,
      y,
    };
  });
  const nodes: WorkflowNodeLayout[] = spec.nodes.map((node) => {
    const row = laneIndex.get(node.lane) ?? 0;
    const lane = lanes[row];
    const h = workflowNodeHeight(node);
    const extra = laneExtra[row] ?? 0;
    const contentTop =
      (lane?.y ?? laneTop) + WORKFLOW_LANE_STRIP + WORKFLOW_LANE_INSET;
    const contentH = laneNodeH[row] ?? h;
    const grouped = nodeInGroup(spec, node);
    const yOffset = grouped ? WORKFLOW_GROUP_STRIP : extra / 2;
    return {
      detail: node.detail?.trim() ?? "",
      h,
      id: node.id,
      kind: workflowNodeKind(node.kind),
      label: node.label,
      tag: node.tag?.trim() ?? "",
      w: WORKFLOW_NODE_WIDTH,
      x: columnLeft(node.col, gaps),
      y: contentTop + yOffset + Math.max(0, (contentH - h) / 2),
    };
  });
  const firstLaneY = lanes[0]?.y ?? laneTop;
  const phases: WorkflowPhaseLayout[] = (spec.phases ?? []).map((phase) => {
    const fromX = columnLeft(phase.fromCol, gaps);
    const toX = columnLeft(phase.toCol, gaps) + WORKFLOW_NODE_WIDTH;
    return {
      id: phase.id,
      label: phase.label,
      w: Math.max(WORKFLOW_NODE_WIDTH, toX - fromX),
      x: fromX,
      y: firstLaneY,
    };
  });
  const groups: WorkflowGroupLayout[] = (spec.groups ?? []).map((group) => {
    const row = laneIndex.get(group.lane) ?? 0;
    const lane = lanes[row];
    const left = columnLeft(group.fromCol, gaps);
    const right = columnLeft(group.toCol, gaps) + WORKFLOW_NODE_WIDTH;
    const x = Math.max(
      (lane?.x ?? WORKFLOW_PAD) + 8,
      left - WORKFLOW_GROUP_PAD
    );
    const maxRight = (lane?.x ?? WORKFLOW_PAD) + (lane?.w ?? innerW) - 8;
    return {
      h: Math.max(
        52,
        WORKFLOW_GROUP_STRIP +
          (laneNodeH[row] ?? WORKFLOW_NODE_HEIGHT) +
          WORKFLOW_GROUP_BOTTOM
      ),
      id: group.id,
      label: group.label,
      w: Math.max(
        WORKFLOW_NODE_WIDTH,
        Math.min(maxRight, right + WORKFLOW_GROUP_PAD) - x
      ),
      x,
      y: (lane?.y ?? laneTop) + WORKFLOW_LANE_STRIP + 10,
    };
  });
  return {
    groups,
    lanes,
    nodes,
    phases,
    width,
  };
}

export function workflowBoardChrome(
  laneEnd: number,
  edgeBottom: number,
  legendCount: number,
  notesCount: number
): { height: number; legendY: number; notesY: number } {
  let cursor = Math.max(edgeBottom, laneEnd) + WORKFLOW_PAD;
  const legendY = legendCount > 0 ? cursor : 0;
  if (legendCount > 0) {
    cursor += WORKFLOW_LEGEND_H + 16;
  }
  const notesY = notesCount > 0 ? cursor : 0;
  if (notesCount > 0) {
    cursor += WORKFLOW_NOTES_H;
  }
  return {
    height: Math.ceil(cursor + WORKFLOW_PAD),
    legendY,
    notesY,
  };
}
