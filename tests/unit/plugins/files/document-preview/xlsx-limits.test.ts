import { formatXlsxCell } from "@plugins/builtin/files/renderer/preview/xlsx/format.ts";
import {
  clipXlsxRange,
  XLSX_LIMITS,
} from "@plugins/builtin/files/renderer/preview/xlsx/limits.ts";
import { describe, expect, it } from "vitest";

describe("clipXlsxRange", () => {
  it("clips rows, columns and total cells", () => {
    const tall = clipXlsxRange({
      e: { c: 9, r: 60_000 },
      s: { c: 0, r: 0 },
    });
    expect(tall.rowCount).toBe(XLSX_LIMITS.maxRows);
    expect(tall.columnCount).toBe(10);
    expect(tall.truncated).toBe(true);

    const wide = clipXlsxRange({
      e: { c: 300, r: 60_000 },
      s: { c: 0, r: 0 },
    });
    expect(wide.columnCount).toBe(XLSX_LIMITS.maxColumns);
    expect(wide.rowCount).toBe(
      Math.floor(XLSX_LIMITS.maxCells / XLSX_LIMITS.maxColumns)
    );
    expect(wide.fullRowCount).toBe(60_001);
    expect(wide.fullColumnCount).toBe(301);
    expect(wide.truncated).toBe(true);
  });

  it("keeps small ranges untouched", () => {
    const clipped = clipXlsxRange({
      e: { c: 3, r: 9 },
      s: { c: 1, r: 2 },
    });
    expect(clipped).toEqual({
      columnCount: 3,
      fullColumnCount: 3,
      fullRowCount: 8,
      range: { e: { c: 3, r: 9 }, s: { c: 1, r: 2 } },
      rowCount: 8,
      truncated: false,
    });
  });

  it("handles an empty sheet", () => {
    expect(clipXlsxRange(undefined)).toMatchObject({
      columnCount: 0,
      rowCount: 0,
      truncated: false,
    });
  });
});

describe("formatXlsxCell", () => {
  it("formats numbers right, text left, booleans center", () => {
    expect(formatXlsxCell({ t: "n", v: 42, w: "42" })).toEqual({
      align: "right",
      text: "42",
    });
    expect(formatXlsxCell({ t: "s", v: "hello", w: "hello" })).toEqual({
      align: "left",
      text: "hello",
    });
    expect(formatXlsxCell({ t: "b", v: true, w: "TRUE" })).toEqual({
      align: "center",
      text: "TRUE",
    });
  });

  it("renders empty cells as empty text", () => {
    expect(formatXlsxCell(undefined)).toEqual({ align: "left", text: "" });
  });
});
