import type { XlsxCell } from "./format.ts";
import type { XlsxTruncationReason } from "./limits.ts";

export interface SerializedXlsxMerge {
  /** 0-based column index inside the rendered range. */
  column: number;
  /** Number of rendered columns covered by the anchor cell; at least 2. */
  columnSpan: number;
  /** 0-based row index inside the rendered range. */
  row: number;
}

export interface SerializedXlsxRowHeight {
  /** Document or estimated multi-line height in CSS pixels. */
  height: number;
  /** 0-based row index inside the rendered range. */
  row: number;
}

export interface SerializedXlsxSheet {
  columnCount: number;
  /** Document `!cols` widths for rendered columns; null = no usable hint. */
  columnWidthsPx: Array<number | null>;
  fullColumnCount: number;
  fullRowCount: number;
  /** Horizontal merges whose anchor is inside the rendered range. */
  merges: SerializedXlsxMerge[];
  name: string;
  rowCount: number;
  /** Rows whose document or estimated height differs from the grid default. */
  rowHeights: SerializedXlsxRowHeight[];
  rows: XlsxCell[][];
  /** 0-based column index of the used range's first cell (A = 0). */
  startColumn: number;
  /** 0-based row index of the used range's first cell. */
  startRow: number;
  truncated: boolean;
  /** Why the sheet was clipped; absent only on legacy fixtures. */
  truncatedReason?: XlsxTruncationReason | null;
}

export interface XlsxWorkerRequest {
  bytes: ArrayBuffer;
  id: number;
}

export type XlsxWorkerResponse =
  | { id: number; kind: "ok"; sheets: SerializedXlsxSheet[] }
  | { id: number; kind: "error"; code: "parse-failed" | "zip-limit" };

export function isXlsxWorkerResponse(
  value: unknown
): value is XlsxWorkerResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; kind?: unknown };
  return (
    typeof candidate.id === "number" &&
    (candidate.kind === "ok" || candidate.kind === "error")
  );
}
