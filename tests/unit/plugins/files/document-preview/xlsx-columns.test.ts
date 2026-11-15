import {
  readXlsxColumnWidths,
  writeXlsxColumnWidths,
  xlsxColumnStructureKey,
} from "@plugins/builtin/files/renderer/preview/xlsx/preferences.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("xlsx column width preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keys widths by document, sheet and column count", () => {
    const dataKey = xlsxColumnStructureKey("Data", 2);
    writeXlsxColumnWidths({
      documentId: "doc-1",
      structureKey: dataKey,
      widths: { c0: 300 },
    });

    expect(readXlsxColumnWidths("doc-1", dataKey)).toEqual({ c0: 300 });
    // Another sheet in the same workbook must not inherit Data's widths.
    expect(
      readXlsxColumnWidths("doc-1", xlsxColumnStructureKey("Summary", 2))
    ).toBeNull();
    // Another document must not inherit them either.
    expect(readXlsxColumnWidths("doc-2", dataKey)).toBeNull();
  });

  it("invalidates widths when the column count changes", () => {
    const before = xlsxColumnStructureKey("Data", 2);
    writeXlsxColumnWidths({
      documentId: "doc-1",
      structureKey: before,
      widths: { c0: 300 },
    });

    expect(
      readXlsxColumnWidths("doc-1", xlsxColumnStructureKey("Data", 3))
    ).toBeNull();
  });

  it("ignores invalid widths and corrupted payloads", () => {
    const structureKey = xlsxColumnStructureKey("Data", 2);
    writeXlsxColumnWidths({
      documentId: "doc-1",
      structureKey,
      widths: {},
    });
    const storageKey = localStorage.key(0);
    expect(storageKey).not.toBeNull();
    localStorage.setItem(
      storageKey ?? "",
      JSON.stringify({ c0: 120, c1: 0, c2: -5, c3: "wide", c4: 88.6 })
    );

    expect(readXlsxColumnWidths("doc-1", structureKey)).toEqual({
      c0: 120,
      c4: 89,
    });

    localStorage.setItem(storageKey ?? "", "{not json");
    expect(readXlsxColumnWidths("doc-1", structureKey)).toBeNull();
  });
});
