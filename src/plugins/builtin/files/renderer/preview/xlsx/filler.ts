import type { Column } from "react-data-grid";
import { csvColumnLetter } from "../csv/model.ts";

export const FILLER_COLUMN_KEY_PREFIX = "__filler";
/** Excel's default column width (8.43 characters) at 96 DPI. */
export const FILLER_COLUMN_WIDTH = 64;
/**
 * Trailing empty rows, matching the CSV preview. The sheet must keep drawing
 * cells below the used range like Excel instead of exposing a blank panel.
 */
export const FILLER_ROW_COUNT = 200;

/**
 * Empty columns after the used range. Excel keeps drawing default-width
 * columns across the rest of the window; stretching the real columns instead
 * would misrepresent the document's own widths.
 */
export function fillerColumns<Row>(
  remainingWidth: number,
  firstColumn: number
): Column<Row>[] {
  if (remainingWidth <= 0) {
    return [];
  }
  const count = Math.max(1, Math.ceil(remainingWidth / FILLER_COLUMN_WIDTH));
  const baseWidth = Math.floor(remainingWidth / count);
  const widerColumns = remainingWidth - baseWidth * count;
  return Array.from({ length: count }, (_, index) => {
    const width = baseWidth + (index < widerColumns ? 1 : 0);
    return {
      editable: false,
      key: `${FILLER_COLUMN_KEY_PREFIX}${index}`,
      maxWidth: width,
      minWidth: width,
      name: csvColumnLetter(firstColumn + index),
      renderCell: () => null,
      resizable: false,
      width,
    };
  });
}
