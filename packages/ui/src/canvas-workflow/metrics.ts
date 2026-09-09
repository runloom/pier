export const WORKFLOW_NODE_WIDTH = 132;
export const WORKFLOW_NODE_HEIGHT = 52;
export const WORKFLOW_NODE_DETAIL = 52;
export const WORKFLOW_NODE_TAGGED = 68;
export const WORKFLOW_COL_GAP = 44;
/** Extra air around a same-lane label: shaft, pill, dart. */
export const WORKFLOW_LABEL_CLEAR = 16;
export const WORKFLOW_ROW_GAP = 112;
export const WORKFLOW_PAD = 40;
/** Inner pad from the lane frame to the first column. */
export const WORKFLOW_LANE_INSET = 8;
export const WORKFLOW_LANE_GUTTER = WORKFLOW_PAD + WORKFLOW_LANE_INSET;
export const WORKFLOW_LANE_STRIP = 22;
export const WORKFLOW_LANE_GAP = 32;
export const WORKFLOW_TITLE_H = 28;
export const WORKFLOW_GROUP_PAD = 10;
/** Extra below grouped nodes so an in-lane U-turn stays inside the frame. */
export const WORKFLOW_GROUP_BOTTOM = 34;
export const WORKFLOW_GROUP_STRIP = 18;
export const WORKFLOW_LEGEND_H = 28;
export const WORKFLOW_NOTES_H = 96;
/** Last-segment length; must exceed arrow gap + dart so the tip has a shaft. */
export const WORKFLOW_STUB = 24;
export const WORKFLOW_STROKE = 1.5;
export const WORKFLOW_RETURN_GAP = 16;
/** Lateral offset for a same-column return so it does not climb the error drop. */
export const WORKFLOW_RETURN_SIDE = 36;
export const WORKFLOW_LABEL_MAX = 160;
export const WORKFLOW_HIT_STROKE = 14;
export const WORKFLOW_DIM_OPACITY = 0.35;
export const WORKFLOW_ARROW_SIZE = 8;
/** Half-width of the dart; base caps the 1.5px stroke. */
export const WORKFLOW_ARROW_HALF = 4;
/** Dart tip on the node edge. */
export const WORKFLOW_ARROW_GAP = 0;
/** Stroke nips into the dart so the shaft does not leave a gap. */
export const WORKFLOW_ARROW_OVERLAP = 1;
/** Knockout pill height; labels sit on the longest run. */
export const WORKFLOW_LABEL_PILL = 14;

export function workflowLabelWidth(label: string): number {
  let width = 10;
  for (const char of label) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 127 ? 8 : 5.4;
  }
  return Math.max(28, width);
}
