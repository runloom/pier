import {
  csvColumnLetter,
  csvDisplayColumnLabels,
  csvGridRows,
  csvMatrixFromRows,
  csvRawHeaderLabels,
} from "@plugins/builtin/files/renderer/preview/csv/model.ts";
import { parseCsv } from "@plugins/builtin/files/renderer/preview/csv/parser.ts";
import { describe, expect, it } from "vitest";

describe("csv grid model", () => {
  it("projects row values onto react-data-grid column keys", () => {
    const table = parseCsv("name,role\nAda,engineer\nBob,designer\n", ",");
    const rows = csvGridRows(table, true, table.columnCount);
    expect(rows).toEqual([
      { c0: "Ada", c1: "engineer", id: 1 },
      { c0: "Bob", c1: "designer", id: 2 },
    ]);
    expect(csvMatrixFromRows(table, true, rows, table.columnCount)).toEqual([
      ["name", "role"],
      ["Ada", "engineer"],
      ["Bob", "designer"],
    ]);
  });

  it("keeps the first row as data when the header toggle is off", () => {
    const table = parseCsv("Ada,engineer\nBob,designer\n", ",");
    const rows = csvGridRows(table, false, table.columnCount);
    expect(rows[0]?.c0).toBe("Ada");
    expect(rows[0]?.id).toBe(0);
    expect(csvRawHeaderLabels(table, false)).toEqual([]);
  });

  it("builds stable fallback labels for empty and duplicate headers", () => {
    expect(csvDisplayColumnLabels(["", "", "role", "role"])).toEqual([
      "A",
      "B",
      "role",
      "role (2)",
    ]);
    expect(csvDisplayColumnLabels(["id", "id (2)", "id"])).toEqual([
      "id",
      "id (2)",
      "id (3)",
    ]);
    expect(csvColumnLetter(0)).toBe("A");
    expect(csvColumnLetter(25)).toBe("Z");
    expect(csvColumnLetter(26)).toBe("AA");
  });

  it("pads ragged rows to the grid column count", () => {
    const table = parseCsv("a,b,c\n1,2\n", ",");
    const rows = csvGridRows(table, true, table.columnCount);
    expect(rows[0]).toEqual({ c0: "1", c1: "2", c2: "", id: 1 });
  });
});
