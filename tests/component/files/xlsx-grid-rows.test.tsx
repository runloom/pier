import type { FilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import { XlsxGrid } from "@plugins/builtin/files/renderer/preview/xlsx/grid.tsx";
import type { SerializedXlsxSheet } from "@plugins/builtin/files/renderer/preview/xlsx/protocol.ts";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const gridMock = vi.hoisted(() => ({ rows: [] as unknown[][] }));

vi.mock("react-data-grid", () => ({
  DataGrid: (props: { rows: unknown[] }) => {
    gridMock.rows.push(props.rows);
    return <div data-testid="grid" />;
  },
}));

const sheet: SerializedXlsxSheet = {
  columnCount: 1,
  fullColumnCount: 1,
  fullRowCount: 2,
  name: "Data",
  rowCount: 2,
  rows: [[{ align: "left", text: "A" }], [{ align: "left", text: "B" }]],
  startColumn: 0,
  startRow: 0,
  truncated: false,
};

const t: FilesTranslate = (_key, fallback) => fallback ?? "";

describe("XlsxGrid rows", () => {
  it("reuses row wrappers across unrelated re-renders", () => {
    const { rerender } = render(<XlsxGrid sheet={sheet} t={t} />);
    const firstRows = gridMock.rows.at(-1);

    rerender(<XlsxGrid sheet={sheet} t={t} />);

    expect(gridMock.rows.at(-1)).toBe(firstRows);
  });
});
