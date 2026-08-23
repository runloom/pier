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
 * Card chrome: translucent wash of the family hue over the surface plus a
 * same-hue hairline. Diagrams are dense multi-card surfaces — opaque
 * colorXxxBg solids read as mud on near-black canvases, so cards take the
 * hue at low alpha instead (same recipe as widget preview swatches).
 * Kind glyphs stay foreground; run-status marks keep chromatic -fg tokens.
 * Mermaid theme CSS must not paint slotted SVG paths (see theme.ts).
 *
 * Every class name is a verbatim literal: Tailwind extracts candidates
 * statically and silently drops anything composed at runtime, and the
 * status-token family is `destructive/warning/success/info/done`
 * (`--color-*` in tailwind-theme.css) — there is no bare `danger` color.
 */
const HUE_WASH: Record<
  "danger" | "done" | "info" | "success" | "warning",
  string
> = {
  danger: "border-destructive/40 bg-destructive/10",
  done: "border-done/40 bg-done/10",
  info: "border-info/40 bg-info/10",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
};

export const TONE_SURFACE: Partial<Record<MermaidTone, string>> = {
  danger: HUE_WASH.danger,
  done: HUE_WASH.done,
  info: HUE_WASH.info,
  success: HUE_WASH.success,
  warning: HUE_WASH.warning,
};

/** Role chrome: same hue-wash family; artifact/external dashed.
 * Light `--primary` / `--muted` are near-black / near-white — do not use them. */
export const KIND_SURFACE: Record<MermaidKind, string> = {
  actor: HUE_WASH.info,
  agent: HUE_WASH.done,
  artifact: "border-dashed border-info/40 bg-info/10",
  external: "border-dashed border-warning/40 bg-warning/10",
  tool: HUE_WASH.success,
};

/** Kind title-row glyph: foreground so 20px strokes read on pale fills. */
export const KIND_GLYPH = "text-foreground!";

export const SLOT_ATTR = "data-pier-slot";
export const SLOT_CLASS = "pierSlot";
export const SLOT_WIDTH_PX = 220;
export const SLOT_MIN_HEIGHT_PX = 56;
const SLOT_PAD_Y_PX = 24;
const SLOT_GAP_PX = 4;
const SLOT_CONTENT_GAP_PX = 8;
const SLOT_CONTENT_RULE_PX = 1;
const SLOT_CONTENT_PAD_PX = 6;
const SLOT_TITLE_LINE_PX = 20;
const SLOT_META_LINE_PX = 16;
const SLOT_TITLE_CHARS_PER_LINE = 10;
const SLOT_META_CHARS_PER_LINE = 14;

function lineCount(text: string, charsPerLine: number): number {
  return text.split("\n").reduce((sum, line) => {
    const chars = Array.from(line).length;
    return sum + Math.max(1, Math.ceil(chars / charsPerLine));
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

/** Placeholder box mermaid measures before MermaidMark hydrates. */
export function slotHeightPx(node: MermaidNode): number {
  const titles = lineCount(node.title, SLOT_TITLE_CHARS_PER_LINE);
  const metas = node.meta ? lineCount(node.meta, SLOT_META_CHARS_PER_LINE) : 0;
  const extra = node.contentHeight ?? 0;
  const lines =
    SLOT_PAD_Y_PX +
    titles * SLOT_TITLE_LINE_PX +
    (metas > 0 ? SLOT_GAP_PX + metas * SLOT_META_LINE_PX : 0) +
    (extra > 0
      ? SLOT_CONTENT_GAP_PX + SLOT_CONTENT_RULE_PX + SLOT_CONTENT_PAD_PX + extra
      : 0);
  return Math.max(SLOT_MIN_HEIGHT_PX, lines);
}
