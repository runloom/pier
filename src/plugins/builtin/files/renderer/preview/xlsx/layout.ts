import type { XlsxCell } from "./format.ts";

/**
 * Single source for XLSX grid geometry. The worker-side model (document
 * widths/heights) and the renderer grid (drag bounds, filler math, wrapping)
 * must agree; duplicating these bounds lets one side clamp to a different
 * range than the other.
 */
export const XLSX_ROW_HEIGHT_PX = 28;
export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 1200;
/** Excel caps rows at 409pt (~545px); larger values are corrupt. */
export const MAX_ROW_HEIGHT_PX = 545;
export const BASE_COLUMN_WIDTH = 96;
export const BASE_COLUMN_MAX_WIDTH = 320;
/** Display cells are monospace-cell equivalents; CJK counts as two. */
export const BASE_CHARACTER_WIDTH_PX = 8;
/** Cell padding + grid line reserved when estimating wrapped line capacity. */
export const COLUMN_CONTENT_INSET_PX = 32;
export const LINE_HEIGHT_PX = 20;
export const CELL_VERTICAL_PADDING_PX = 8;

/** CJK / fullwidth characters occupy two monospace cells, like Excel. */
const WIDE_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function textDisplayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width += WIDE_CHARACTER_PATTERN.test(character) ? 2 : 1;
  }
  return width;
}

export function estimatedTextLines(text: string, columnWidth: number): number {
  const capacity = Math.max(
    1,
    Math.floor(
      (columnWidth - COLUMN_CONTENT_INSET_PX) / BASE_CHARACTER_WIDTH_PX
    )
  );
  let lines = 0;
  for (const segment of text.split(/\r?\n/u)) {
    lines += Math.max(1, Math.ceil(textDisplayWidth(segment) / capacity));
  }
  return Math.max(1, lines);
}

/**
 * Height for a row that has no document height but embeds line breaks.
 * Spreadsheet generators routinely write `\n` without a `!rows` entry; Excel
 * then auto-fits the row instead of collapsing the text into one ellipsized
 * line. The estimate mirrors the grid's text metrics (8px per display cell,
 * 20px line box, 8px vertical padding).
 */
export function estimatedMultiLineRowHeightPx(
  cells: readonly XlsxCell[],
  columnWidths: readonly (number | null)[]
): number {
  let lines = 1;
  for (let index = 0; index < cells.length; index += 1) {
    const text = cells[index]?.text ?? "";
    if (!text.includes("\n")) {
      continue;
    }
    lines = Math.max(
      lines,
      estimatedTextLines(text, columnWidths[index] ?? BASE_COLUMN_WIDTH)
    );
  }
  const height = lines * LINE_HEIGHT_PX + CELL_VERTICAL_PADDING_PX;
  if (height <= XLSX_ROW_HEIGHT_PX) {
    return XLSX_ROW_HEIGHT_PX;
  }
  return Math.min(MAX_ROW_HEIGHT_PX, height + 1);
}
