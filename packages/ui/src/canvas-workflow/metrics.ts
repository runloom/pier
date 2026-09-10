export const WORKFLOW_NODE_WIDTH = 132;
export const WORKFLOW_NODE_HEIGHT = 52;
export const WORKFLOW_NODE_DETAIL = 52;
export const WORKFLOW_NODE_TAGGED = 68;
export const WORKFLOW_COL_GAP = 44;
export const WORKFLOW_LABEL_CLEAR = 16;
export const WORKFLOW_ROW_GAP = 112;
export const WORKFLOW_PAD = 40;
export const SCREEN_FLOW_FRAME_MIN = 240;
export const WORKFLOW_LANE_INSET = 8;
export const WORKFLOW_LANE_GUTTER = WORKFLOW_PAD + WORKFLOW_LANE_INSET;
export const WORKFLOW_LANE_STRIP = 22;
export const WORKFLOW_LANE_GAP = 40;
export const WORKFLOW_TITLE_H = 28;
export const WORKFLOW_GROUP_PAD = 10;
export const WORKFLOW_GROUP_BOTTOM = 44;
export const WORKFLOW_GROUP_STRIP = 18;
export const WORKFLOW_LEGEND_H = 28;
export const WORKFLOW_NOTES_H = 96;
export const WORKFLOW_STUB = 24;
export const WORKFLOW_STROKE = 1.8;
export const WORKFLOW_STROKE_SIDE = 1.4;
export const WORKFLOW_RETURN_GAP = 20;
export const WORKFLOW_RETURN_SIDE = 36;
export const SCREEN_FLOW_RETURN_SIDE = 56;
export const WORKFLOW_LABEL_MAX = 160;
export const WORKFLOW_HIT_STROKE = 14;
export const WORKFLOW_ARROW_SIZE = 10;
export const WORKFLOW_ARROW_HALF = 3.5;
export const WORKFLOW_ARROW_GAP = 0;
export const WORKFLOW_ARROW_OVERLAP = 1;
export const WORKFLOW_LABEL_PILL = 18;
export const WORKFLOW_LABEL_SIZE = 11;
export const WORKFLOW_FLOW_STROKE = 3.35;
export const SCREEN_FLOW_LABEL_PILL = 22;
export const SCREEN_FLOW_LABEL_SIZE = 12;
export const SCREEN_FLOW_LABEL_SCALE = 12 / 7;
export const WORKFLOW_LABEL_GAP = 6;
export const SCREEN_FLOW_LABEL_GAP = 12;
/** Error / hop / return ports on a large frame so the C-return misses the hop. */
export const SCREEN_FLOW_PORT_CONTENT = 0.28;
export const SCREEN_FLOW_PORT_ROW = 0.5;
export const SCREEN_FLOW_PORT_RETURN = 0.72;

export function isScreenFlowFrame(node: {
  readonly h?: number;
  readonly w: number;
}): boolean {
  return node.w >= SCREEN_FLOW_FRAME_MIN || (node.h ?? 0) >= 100;
}

export function workflowLabelWidth(label: string): number {
  let width = 10;
  for (const char of label) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 127 ? 8 : 5.4;
  }
  return Math.max(28, width);
}
