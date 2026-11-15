import { buildXlsxSheets } from "@plugins/builtin/files/renderer/preview/xlsx/model.ts";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

type DocumentColumn = XLSX.ColInfo & { customwidth?: string };

function documentColumn(px: number): DocumentColumn {
  return { customwidth: "1", wpx: px };
}

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

  it("serializes horizontal merges and keeps covered cells empty", () => {
    const [data] = buildXlsxSheets(workbook());
    expect(data?.rows[2]?.[0]).toEqual({ align: "left", text: "Merged" });
    expect(data?.rows[2]?.[1]).toEqual({ align: "left", text: "" });
    expect(data?.merges).toEqual([{ column: 0, columnSpan: 2, row: 2 }]);
  });

  it("honors varied document column widths", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["A", "B", "C"]]);
    sheet["!cols"] = [
      documentColumn(48),
      documentColumn(156),
      documentColumn(660),
    ];
    XLSX.utils.book_append_sheet(book, sheet, "Widths");

    const [widths] = buildXlsxSheets(book);
    expect(widths?.columnWidthsPx).toEqual([48, 156, 660]);
  });

  it("ignores a uniform default column width", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["A", "B", "C"]]);
    // Exporters routinely stamp the same default width onto every column.
    sheet["!cols"] = [{ wpx: 64 }, { wpx: 64 }, { wpx: 64 }];
    XLSX.utils.book_append_sheet(book, sheet, "Defaults");

    const [defaults] = buildXlsxSheets(book);
    expect(defaults?.columnWidthsPx).toEqual([null, null, null]);
  });

  it("keeps explicit custom widths even when they are uniform", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["A", "B"]]);
    sheet["!cols"] = [documentColumn(120), documentColumn(120)];
    XLSX.utils.book_append_sheet(book, sheet, "Custom");

    const [custom] = buildXlsxSheets(book);
    expect(custom?.columnWidthsPx).toEqual([120, 120]);
  });

  it("maps document widths onto the used-range origin", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.sheet_add_aoa({}, [["Header", "Value"]], {
      origin: "C5",
    });
    sheet["!ref"] = "C5:D5";
    const columns: DocumentColumn[] = [];
    columns[2] = documentColumn(120);
    columns[3] = documentColumn(240);
    sheet["!cols"] = columns;
    XLSX.utils.book_append_sheet(book, sheet, "Offset");

    const [offset] = buildXlsxSheets(book);
    expect(offset?.columnWidthsPx).toEqual([120, 240]);
  });

  it("converts document row heights from points to CSS pixels", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["A"], ["B"], ["C"]]);
    // SheetJS sets hpx = pt2px(hpt), and pt2px is an identity because its PPI
    // is 96. Both fields therefore carry the point value read from `ht`.
    sheet["!rows"] = [
      { hpt: 21, hpx: 21 },
      { hpt: 51.75, hpx: 51.75 },
      { hpt: 900, hpx: 900 },
    ];
    XLSX.utils.book_append_sheet(book, sheet, "Heights");

    const [heights] = buildXlsxSheets(book);
    expect(heights?.rowHeights).toEqual([
      { height: 28, row: 0 },
      { height: 70, row: 1 },
      { height: 545, row: 2 },
    ]);
  });

  it("falls back to hpx when a producer omits hpt", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["A"]]);
    sheet["!rows"] = [{ hpx: 60 }];
    XLSX.utils.book_append_sheet(book, sheet, "Fallback");

    const [fallback] = buildXlsxSheets(book);
    expect(fallback?.rowHeights).toEqual([{ height: 61, row: 0 }]);
  });

  it("estimates a wrapped height for newline text without a document height", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["aaaa\nbbbb"]]);
    XLSX.utils.book_append_sheet(book, sheet, "Wrapped");

    const [wrapped] = buildXlsxSheets(book);
    // 96px default column = 8 display cells per line; two explicit lines
    // (2 x 20px + 8px padding + 1px grid line).
    expect(wrapped?.rowHeights).toEqual([{ height: 49, row: 0 }]);
  });

  it("keeps document heights over newline estimates", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["aaaa\nbbbb"]]);
    sheet["!rows"] = [{ hpt: 30, hpx: 30 }];
    XLSX.utils.book_append_sheet(book, sheet, "Fixed");

    const [fixed] = buildXlsxSheets(book);
    // ceil(30pt x 4/3) = 40px + 1px border, not the 49px line estimate.
    expect(fixed?.rowHeights).toEqual([{ height: 41, row: 0 }]);
  });

  it("counts CJK characters as two cells when estimating lines", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["一二三四五六七八\n九十"]]);
    XLSX.utils.book_append_sheet(book, sheet, "Cjk");

    const [cjk] = buildXlsxSheets(book);
    // First segment is 16 display cells -> 2 lines; second is one line.
    expect(cjk?.rowHeights).toEqual([{ height: 69, row: 0 }]);
  });

  it("only serializes horizontal merge anchors inside the rendered range", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["A", "B", "C"],
      ["D", "E", "F"],
      ["G", "H", "I"],
    ]);
    sheet["!merges"] = [
      // A1:C1 is kept, clipped to the rendered three columns.
      { e: { c: 2, r: 0 }, s: { c: 0, r: 0 } },
      // A2:A3 is vertical only; rowSpan is not supported.
      { e: { c: 0, r: 2 }, s: { c: 0, r: 1 } },
      // Anchor outside the rendered range is not a span here.
      { e: { c: 8, r: 1 }, s: { c: 7, r: 1 } },
    ];
    XLSX.utils.book_append_sheet(book, sheet, "Merges");

    const [merges] = buildXlsxSheets(book);
    expect(merges?.merges).toEqual([{ column: 0, columnSpan: 3, row: 0 }]);
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

  it("spends one cell budget across every sheet in the workbook", () => {
    const sheets = buildXlsxSheets(workbook(), { maxWorkbookCells: 6 });

    expect(sheets[0]).toMatchObject({
      rowCount: 2,
      truncated: true,
      truncatedReason: "cells",
    });
    expect(sheets[1]).toMatchObject({
      rowCount: 0,
      truncated: true,
      truncatedReason: "cells",
    });
  });

  it("clips merged rectangles before enumerating covered cells", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Top", "covered"],
      ["covered", "covered"],
    ]);
    // A sheet-sized merge must not enumerate 16k columns x 1M rows.
    sheet["!merges"] = [{ e: { c: 16_383, r: 1_048_575 }, s: { c: 0, r: 0 } }];
    XLSX.utils.book_append_sheet(book, sheet, "Huge");

    const [huge] = buildXlsxSheets(book);
    expect(huge?.rowCount).toBe(2);
    expect(huge?.rows[0]?.[0]).toEqual({ align: "left", text: "Top" });
    expect(huge?.rows[0]?.[1]).toEqual({ align: "left", text: "" });
    expect(huge?.rows[1]?.[0]).toEqual({ align: "left", text: "" });
  });
});
