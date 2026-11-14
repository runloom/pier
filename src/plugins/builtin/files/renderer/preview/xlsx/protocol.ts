import type { XlsxCell } from "./format.ts";
import type { XlsxTruncationReason } from "./limits.ts";

export interface SerializedXlsxSheet {
  columnCount: number;
  fullColumnCount: number;
  fullRowCount: number;
  name: string;
  rowCount: number;
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
