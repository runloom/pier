import {
  clampColumnWidth,
  readTableWidths,
  resetTableWidths,
  TABLE_MIN_COLUMN_WIDTH_PX,
  TABLE_WIDTHS_CHANGED_EVENT,
  writeTableColumnWidth,
} from "@plugins/builtin/files/renderer/markdown/table/table-width-preferences.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("table width preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a column width per file+hash", () => {
    writeTableColumnWidth({
      sourcePath: "/a.md",
      contentHash: "h1",
      columnIndex: 2,
      widthPx: 120,
    });
    expect(readTableWidths("/a.md", "h1")).toEqual({ "2": 120 });
    expect(readTableWidths("/a.md", "other")).toBeNull();
    expect(readTableWidths("/b.md", "h1")).toBeNull();
  });

  it("clamps below minimum", () => {
    expect(clampColumnWidth(10)).toBe(TABLE_MIN_COLUMN_WIDTH_PX);
    expect(clampColumnWidth(300)).toBe(300);
  });

  it("reset removes hash entry and keeps others", () => {
    writeTableColumnWidth({
      sourcePath: "/a.md",
      contentHash: "h1",
      columnIndex: 0,
      widthPx: 80,
    });
    writeTableColumnWidth({
      sourcePath: "/a.md",
      contentHash: "h2",
      columnIndex: 0,
      widthPx: 90,
    });
    resetTableWidths("/a.md", "h1");
    expect(readTableWidths("/a.md", "h1")).toBeNull();
    expect(readTableWidths("/a.md", "h2")).toEqual({ "0": 90 });
  });

  it("notifies same-window listeners via CustomEvent", () => {
    const spy = vi.fn();
    window.addEventListener(TABLE_WIDTHS_CHANGED_EVENT, spy);
    writeTableColumnWidth({
      sourcePath: "/a.md",
      contentHash: "h1",
      columnIndex: 0,
      widthPx: 80,
    });
    window.removeEventListener(TABLE_WIDTHS_CHANGED_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
