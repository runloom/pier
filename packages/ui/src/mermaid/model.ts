export type MermaidDirection = "left-to-right" | "top-to-bottom";
export type MermaidTone =
  | "danger"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";
/** Architecture role. Do not reuse `tone` (status) as decoration. */
export type MermaidKind = "actor" | "agent" | "artifact" | "external" | "tool";
/** Live run state for DAG / pipeline nodes (orthogonal to `tone`/`kind`). */
export type MermaidRunStatus =
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "success";
/** Flowchart silhouette. Omit for Pier cards. */
export type MermaidShape = "circle" | "diamond" | "rect" | "round";

export interface MermaidNode {
  /**
   * Reserved height (px) for `renderNodeContent` output, so mermaid's
   * htmlLabel box includes the slot. Required whenever the slot renders.
   */
  contentHeight?: number;
  id: string;
  /** Role chrome for architecture / main-loop graphs. */
  kind?: MermaidKind;
  meta?: string;
  shape?: MermaidShape;
  /** Live run state — trailing glyph in the title row (DAG / pipelines). */
  status?: MermaidRunStatus;
  /** Accessible name for the status glyph; defaults to the status word. */
  statusLabel?: string;
  title: string;
  /** Status tint for error exits. Wins over `kind` chrome. */
  tone?: MermaidTone;
}

export interface MermaidEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

/**
 * Same wash as `workflowKindFill` / `workflowKindStroke`.
 * Do not use `--muted` / `--primary` as role chrome.
 */
const INFO_FILL = "color-mix(in srgb, var(--status-info-fg) 10%, var(--card))";
const DANGER_FILL =
  "color-mix(in srgb, var(--status-danger-fg) 18%, var(--card))";
const WARNING_FILL =
  "color-mix(in srgb, var(--status-warning-fg) 18%, var(--card))";
const SUCCESS_FILL =
  "color-mix(in srgb, var(--status-success-fg) 18%, var(--card))";
const DONE_FILL = "color-mix(in srgb, var(--status-done-fg) 18%, var(--card))";
const MUTED_FILL =
  "color-mix(in srgb, var(--muted-foreground) 12%, var(--card))";

const TONE_FILL: Record<Exclude<MermaidTone, "muted">, string> = {
  danger: DANGER_FILL,
  done: DONE_FILL,
  info: INFO_FILL,
  success: SUCCESS_FILL,
  warning: WARNING_FILL,
};

const TONE_STROKE: Record<Exclude<MermaidTone, "muted">, string> = {
  danger: "var(--status-danger-fg)",
  done: "var(--status-done-fg)",
  info: "var(--status-info-fg)",
  success: "var(--status-success-fg)",
  warning: "var(--status-warning-fg)",
};

const KIND_FILL: Record<MermaidKind, string> = {
  actor: INFO_FILL,
  agent: DONE_FILL,
  artifact: INFO_FILL,
  external: MUTED_FILL,
  tool: SUCCESS_FILL,
};

const KIND_STROKE: Record<MermaidKind, string> = {
  actor: "var(--status-info-fg)",
  agent: "var(--status-done-fg)",
  artifact: "var(--status-info-fg)",
  external: "var(--muted-foreground)",
  tool: "var(--status-success-fg)",
};

export interface MermaidNodePaint {
  dashed: boolean;
  fill: string | undefined;
  stroke: string | undefined;
}

/** Fill/stroke for a slotted card. Tone wins the wash and drops the kind dash. */
export function mermaidNodePaint(
  node: Pick<MermaidNode, "kind" | "tone">
): MermaidNodePaint {
  if (node.tone && node.tone !== "muted") {
    return {
      dashed: false,
      fill: TONE_FILL[node.tone],
      stroke: TONE_STROKE[node.tone],
    };
  }
  if (node.kind) {
    return {
      dashed: node.kind === "artifact" || node.kind === "external",
      fill: KIND_FILL[node.kind],
      stroke: KIND_STROKE[node.kind],
    };
  }
  return { dashed: false, fill: undefined, stroke: undefined };
}

export const SLOT_ATTR = "data-pier-slot";
export const SLOT_CLASS = "pierSlot";
export const SLOT_WIDTH_PX = 220;
const SLOT_PAD_Y_PX = 24;
/** 1.5px hairline × 2; box-border includes it in width and height. */
const SLOT_BORDER_PX = 3;
const SLOT_GAP_PX = 4;
const SLOT_CONTENT_GAP_PX = 8;
const SLOT_CONTENT_RULE_PX = 1;
const SLOT_CONTENT_PAD_PX = 6;
const SLOT_TITLE_LINE_PX = 20;
const SLOT_META_LINE_PX = 16;
const SLOT_PAD_X_PX = 24;
const SLOT_ICON_COL_PX = 28;
const SLOT_STATUS_COL_PX = 20;
/** text-sm / text-xs: CJK ≈ 1em, ASCII ≈ 0.55em. */
const SLOT_TITLE_CJK_PX = 14;
const SLOT_TITLE_ASCII_PX = 8;
const SLOT_META_CJK_PX = 12;
const SLOT_META_ASCII_PX = 7;
export const SLOT_MIN_HEIGHT_PX =
  SLOT_PAD_Y_PX + SLOT_BORDER_PX + SLOT_TITLE_LINE_PX;

function measurePx(text: string, widePx: number, narrowPx: number): number {
  let width = 0;
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 127 ? widePx : narrowPx;
  }
  return width;
}

/** Match CSS `break-words`: wrap on whitespace, then break an overflowing token. */
function wrappedLines(
  text: string,
  availablePx: number,
  widePx: number,
  narrowPx: number
): number {
  const col = Math.max(1, availablePx);
  const space = measurePx(" ", widePx, narrowPx);
  return text.split("\n").reduce((sum, paragraph) => {
    const tokens = paragraph.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return sum + 1;
    }
    let lines = 1;
    let used = 0;
    for (const token of tokens) {
      const tokenW = measurePx(token, widePx, narrowPx);
      if (used > 0 && used + space + tokenW <= col) {
        used += space + tokenW;
        continue;
      }
      if (used > 0) {
        lines += 1;
        used = 0;
      }
      if (tokenW <= col) {
        used = tokenW;
        continue;
      }
      const pieces = Math.ceil(tokenW / col);
      lines += pieces - 1;
      const rem = tokenW % col;
      used = rem === 0 ? col : rem;
    }
    return sum + lines;
  }, 0);
}

/** Architecture / status cards use htmlLabel slots; explicit `shape` stays native. */
export function nodeNeedsSlot(node: MermaidNode): boolean {
  if (
    node.kind ||
    node.tone ||
    node.status ||
    (node.contentHeight !== undefined && node.contentHeight > 0)
  ) {
    return true;
  }
  return !node.shape;
}

function titleColPx(node: MermaidNode): number {
  let px = SLOT_WIDTH_PX - SLOT_PAD_X_PX - SLOT_BORDER_PX;
  if (node.kind) {
    px -= SLOT_ICON_COL_PX;
  }
  if (node.status) {
    px -= SLOT_STATUS_COL_PX;
  }
  return px;
}

/** Placeholder box mermaid measures before MermaidMark hydrates. */
export function slotHeightPx(node: MermaidNode): number {
  const col = titleColPx(node);
  const titles = wrappedLines(
    node.title,
    col,
    SLOT_TITLE_CJK_PX,
    SLOT_TITLE_ASCII_PX
  );
  const metas = node.meta
    ? wrappedLines(node.meta, col, SLOT_META_CJK_PX, SLOT_META_ASCII_PX)
    : 0;
  const extra = node.contentHeight ?? 0;
  const height =
    SLOT_PAD_Y_PX +
    SLOT_BORDER_PX +
    titles * SLOT_TITLE_LINE_PX +
    (metas > 0 ? SLOT_GAP_PX + metas * SLOT_META_LINE_PX : 0) +
    (extra > 0
      ? SLOT_CONTENT_GAP_PX + SLOT_CONTENT_RULE_PX + SLOT_CONTENT_PAD_PX + extra
      : 0);
  return Math.max(SLOT_MIN_HEIGHT_PX, height);
}
