import {
  FILLER_COLUMN_WIDTH,
  fillerColumns,
} from "@plugins/builtin/files/renderer/preview/xlsx/filler.ts";
import { describe, expect, it } from "vitest";

describe("fillerColumns", () => {
  it("fills the remaining width with default-width blank columns", () => {
    const columns = fillerColumns(190, 3);

    expect(columns.map((column) => column.name)).toEqual(["D", "E", "F"]);
    expect(columns.map((column) => column.key)).toEqual([
      "__filler0",
      "__filler1",
      "__filler2",
    ]);
    expect(columns.map((column) => Number(column.width ?? 0))).toEqual([
      64, 63, 63,
    ]);
    expect(
      columns.reduce((total, column) => total + Number(column.width ?? 0), 0)
    ).toBe(190);
    // Blank columns are chrome, not document/data columns.
    expect(
      columns.every(
        (column) => column.editable === false && column.resizable === false
      )
    ).toBe(true);
  });

  it("splits a remainder narrower than the default width evenly", () => {
    const columns = fillerColumns(FILLER_COLUMN_WIDTH - 1, 0);

    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatchObject({
      key: "__filler0",
      name: "A",
      width: FILLER_COLUMN_WIDTH - 1,
    });
  });

  it("adds nothing when the real columns already fill the viewport", () => {
    expect(fillerColumns(0, 3)).toEqual([]);
    expect(fillerColumns(-10, 3)).toEqual([]);
  });
});
