import type { FilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import { XlsxGrid } from "@plugins/builtin/files/renderer/preview/xlsx/grid.tsx";
import type { SerializedXlsxSheet } from "@plugins/builtin/files/renderer/preview/xlsx/protocol.ts";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const gridMock = vi.hoisted(() => ({
  rowHeight: [] as unknown[],
  rows: [] as unknown[][],
}));

vi.mock("react-data-grid", () => ({
  DataGrid: (props: { rowHeight?: unknown; rows: unknown[] }) => {
    gridMock.rowHeight.push(props.rowHeight);
    gridMock.rows.push(props.rows);
    return <div data-testid="grid" />;
  },
}));

const sheet: SerializedXlsxSheet = {
  columnCount: 1,
  columnWidthsPx: [null],
  fullColumnCount: 1,
  fullRowCount: 2,
  merges: [],
  name: "Data",
  rowCount: 2,
  rowHeights: [],
  rows: [[{ align: "left", text: "A" }], [{ align: "left", text: "B" }]],
  startColumn: 0,
  startRow: 0,
  truncated: false,
};

const t: FilesTranslate = (_key, fallback) => fallback ?? "";

describe("XlsxGrid rows", () => {
  const noopColumnWidths = () => undefined;

  it("reuses row wrappers across unrelated re-renders", () => {
    const { rerender } = render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={sheet}
        t={t}
      />
    );
    const firstRows = gridMock.rows.at(-1);

    rerender(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={sheet}
        t={t}
      />
    );

    expect(gridMock.rows.at(-1)).toBe(firstRows);
  });

  it("keeps the rowHeight callback stable across re-renders", () => {
    const { rerender } = render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={sheet}
        t={t}
      />
    );
    const firstRowHeight = gridMock.rowHeight.at(-1);

    rerender(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={sheet}
        t={t}
      />
    );

    // A new function identity makes react-data-grid rebuild the O(rows)
    // row-position map on every click and column drag.
    expect(gridMock.rowHeight.at(-1)).toBe(firstRowHeight);
  });
});
