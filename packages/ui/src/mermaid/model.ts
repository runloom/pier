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
 * Card chrome: the Ant soft-status pairing (`bg-status-*-bg` fill +
 * `bg-status-*-border` hairline) — the same calibrated triad Alert/badges
 * use. Kind glyphs use foreground so 20px strokes stay readable on the
 * pale fill; hue stays in the card surface. Run-status marks keep
 * chromatic tokens. Mermaid theme CSS must not paint those SVG paths
 * (see `MERMAID_THEME_CSS`). Border/fill keep mid/low chroma so a dense
 * graph does not shout.
 */
export const TONE_SURFACE: Partial<Record<MermaidTone, string>> = {
  danger: "border-status-danger-border bg-status-danger-bg",
  done: "border-status-done-border bg-status-done-bg",
  info: "border-status-info-border bg-status-info-bg",
  success: "border-status-success-border bg-status-success-bg",
  warning: "border-status-warning-border bg-status-warning-bg",
};

/** Role chrome: same tint+hairline family; artifact/external dashed.
 * Light `--primary` / `--muted` are near-black / near-white — do not use them. */
export const KIND_SURFACE: Record<MermaidKind, string> = {
  actor: "border-status-info-border bg-status-info-bg",
  agent: "border-status-done-border bg-status-done-bg",
  artifact: "border-dashed border-status-info-border bg-status-info-bg",
  external: "border-dashed border-status-warning-border bg-status-warning-bg",
  tool: "border-status-success-border bg-status-success-bg",
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
