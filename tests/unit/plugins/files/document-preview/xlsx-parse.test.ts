import { XLSX_LIMITS } from "@plugins/builtin/files/renderer/preview/xlsx/limits.ts";
import { parseXlsxWorkbook } from "@plugins/builtin/files/renderer/preview/xlsx/parse.ts";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

function writeWorkbook(book: XLSX.WorkBook): Uint8Array {
  const written = XLSX.write(book, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  return new Uint8Array(written);
}

function farSheetWorkbook(originRow: number): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const origin = `A${originRow + 1}`;
  const sheet = XLSX.utils.sheet_add_aoa(
    {},
    [
      ["Header", "Value"],
      ["first", 1],
    ],
    { origin }
  );
  sheet["!ref"] = `${origin}:B${originRow + 2}`;
  XLSX.utils.book_append_sheet(book, sheet, "Far");
  return book;
}

describe("parseXlsxWorkbook", () => {
  it("keeps data for sheets whose used range starts beyond the first parse window", () => {
    const sheets = parseXlsxWorkbook(writeWorkbook(farSheetWorkbook(60_000)));

    expect(sheets[0]).toMatchObject({
      name: "Far",
      rowCount: 2,
      startRow: 60_000,
      truncated: false,
    });
    expect(sheets[0]?.rows[0]?.[0]).toEqual({
      align: "left",
      text: "Header",
    });
    expect(sheets[0]?.rows[1]?.[1]).toEqual({
      align: "right",
      text: "1",
    });
  });

  it("reports sheets that start beyond the parse start-row cap instead of losing them silently", () => {
    const sheets = parseXlsxWorkbook(
      writeWorkbook(farSheetWorkbook(XLSX_LIMITS.maxParseStartRow + 1))
    );

    expect(sheets[0]).toMatchObject({
      name: "Far",
      rowCount: 0,
      truncated: true,
      truncatedReason: "offset",
    });
  });

  it("reads document widths, row heights and merges through the binary parser", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["Name", "Note"],
      ["Alice", "line one\nline two"],
    ]);
    sheet["!merges"] = [{ e: { c: 1, r: 0 }, s: { c: 0, r: 0 } }];
    sheet["!cols"] = [{ wpx: 48 }, { wpx: 660 }];
    // SheetJS serializes `hpx` through the identity `px2pt`, so the workbook
    // stores 21/28/80 as point heights. Reading them back must convert to CSS.
    sheet["!rows"] = [{ hpx: 21 }, { hpx: 28 }, { hpx: 80 }];
    XLSX.utils.book_append_sheet(book, sheet, "Data");

    const [data] = parseXlsxWorkbook(writeWorkbook(book));
    expect(data?.columnWidthsPx).toEqual([48, 660]);
    expect(data?.merges).toEqual([{ column: 0, columnSpan: 2, row: 0 }]);
    expect(data?.rowHeights).toEqual([
      { height: 28, row: 0 },
      { height: 39, row: 1 },
      { height: 108, row: 2 },
    ]);
    expect(data?.rows[2]?.[1]?.text).toBe("line one\nline two");
  });
});
