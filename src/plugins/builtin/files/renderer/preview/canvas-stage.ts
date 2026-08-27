/**
 * Canvas stage detection — single source (governance-locked).
 *
 * The stage is a property of the composed root, not a meta declaration:
 * a canvas whose root primitive renders `data-canvas-stage="world"`
 * (`WorldStage`) gets the viewport-locked zoom/pan shell; everything else
 * stays in the reading flow. A root `data-canvas-fill` drops the flow
 * measure so full-bleed compositions own their scroll. A root
 * `data-canvas-docs` (`DocsShell`) opts into Markdown reading prefs.
 */

export type CanvasStageKind = "flow" | "world";

export type CanvasMeasureMode = "comfortable" | "wide";

export interface CanvasStageInfo {
  readonly docs: boolean;
  readonly fill: boolean;
  readonly stage: CanvasStageKind;
}

export const FLOW_CANVAS_STAGE: CanvasStageInfo = {
  docs: false,
  fill: false,
  stage: "flow",
};

/** Walk single-child wrappers so a boundary div cannot hide the root marker. */
const MAX_ROOT_WALK_DEPTH = 4;

const FLOW_FILL_CLASS = "min-h-full w-full";
const FLOW_PAD_CLASS = "mx-auto min-h-full w-full px-6 py-5";
const FLOW_MEASURE_CLASS = "max-w-5xl";

export function detectCanvasStage(host: HTMLElement): CanvasStageInfo {
  let el: Element | null = host.firstElementChild;
  let depth = 0;
  while (el instanceof HTMLElement && depth < MAX_ROOT_WALK_DEPTH) {
    if (el.dataset.canvasStage === "world") {
      return { docs: false, fill: false, stage: "world" };
    }
    if (el.dataset.canvasFill !== undefined) {
      return { docs: false, fill: true, stage: "flow" };
    }
    if (el.dataset.canvasDocs !== undefined) {
      return { docs: true, fill: false, stage: "flow" };
    }
    if (el.childElementCount !== 1) {
      break;
    }
    el = el.firstElementChild;
    depth += 1;
  }
  return FLOW_CANVAS_STAGE;
}

/**
 * Flow-shell measure. World callers skip this (they only keep `relative`).
 * Wide reading drops the cap only for DocsShell roots — composition flow
 * stays `max-w-5xl`.
 */
export function canvasFlowMeasureClass(
  info: CanvasStageInfo,
  measureMode: CanvasMeasureMode = "comfortable"
): string {
  if (info.fill) {
    return FLOW_FILL_CLASS;
  }
  if (info.docs && measureMode === "wide") {
    return FLOW_PAD_CLASS;
  }
  return `${FLOW_PAD_CLASS} ${FLOW_MEASURE_CLASS}`;
}
