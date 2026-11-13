import type { CellObject } from "xlsx";

export interface XlsxCell {
  align: "left" | "right" | "center";
  text: string;
}

export function formatXlsxCell(cell: CellObject | undefined): XlsxCell {
  const raw = cell?.w ?? cell?.v;
  const text = raw === undefined || raw === null ? "" : String(raw);
  if (cell?.t === "n" || cell?.t === "d") {
    return { align: "right", text };
  }
  if (cell?.t === "b") {
    return { align: "center", text };
  }
  return { align: "left", text };
}
