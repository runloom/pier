import { buildXlsxSheets } from "@plugins/builtin/files/renderer/preview/xlsx/model.ts";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

function workbook(): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([
    ["Name", "Score", "Active"],
    ["Alice", 42, true],
    ["Merged", "hidden", null],
  ]);
  data["!merges"] = [{ e: { c: 1, r: 2 }, s: { c: 0, r: 2 } }];
  XLSX.utils.book_append_sheet(book, data, "Data");
  const summary = XLSX.utils.aoa_to_sheet([["Summary"], ["ok"]]);
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  return book;
}

function offsetWorkbook(): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  // Exported workbooks can declare a used range that starts away from A1.
  // `sheet_add_aoa` anchors the cells at the origin but still expands `!ref`
  // to A1, so the range is pinned explicitly.
  const offset = XLSX.utils.sheet_add_aoa(
    {},
    [
      ["Header", "Value"],
      ["first", 1],
    ],
    { origin: "C5" }
  );
  offset["!ref"] = "C5:D6";
  XLSX.utils.book_append_sheet(book, offset, "Offset");
  return book;
}

describe("buildXlsxSheets", () => {
  it("serializes every sheet with row and column dimensions", () => {
    const sheets = buildXlsxSheets(workbook());

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Data", "Summary"]);
    const data = sheets[0];
    const summary = sheets[1];
    expect(data?.rowCount).toBe(3);
    expect(data?.columnCount).toBe(3);
    expect(summary?.rowCount).toBe(2);
    expect(summary?.columnCount).toBe(1);
    expect(data?.truncated).toBe(false);
  });

  it("keeps only the top-left value of merged cells and does not merge the grid", () => {
    const [data] = buildXlsxSheets(workbook());
    expect(data?.rows[2]?.[0]).toEqual({ align: "left", text: "Merged" });
    expect(data?.rows[2]?.[1]).toEqual({ align: "left", text: "" });
  });

  it("right-aligns numbers and centers booleans", () => {
    const [data] = buildXlsxSheets(workbook());
    expect(data?.rows[0]?.[1]).toEqual({ align: "left", text: "Score" });
    expect(data?.rows[1]?.[1]).toEqual({ align: "right", text: "42" });
    expect(data?.rows[1]?.[2]).toEqual({ align: "center", text: "true" });
  });

  it("keeps the used-range origin for column and row labels", () => {
    const [offset] = buildXlsxSheets(offsetWorkbook());
    expect(offset).toMatchObject({ startColumn: 2, startRow: 4 });
    expect(offset?.rows[0]?.[0]).toEqual({ align: "left", text: "Header" });
    expect(offset?.rows[1]?.[1]).toEqual({ align: "right", text: "1" });
  });
});
