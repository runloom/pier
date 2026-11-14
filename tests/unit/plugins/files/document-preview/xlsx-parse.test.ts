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
});
