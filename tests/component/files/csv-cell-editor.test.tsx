import { CsvCellEditor } from "@plugins/builtin/files/renderer/preview/csv/cell-editor.tsx";
import type { CsvGridRow } from "@plugins/builtin/files/renderer/preview/csv/model.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RenderEditCellProps } from "react-data-grid";
import { afterEach, describe, expect, it, vi } from "vitest";

function editorProps(
  value: string,
  onRowChange = vi.fn(),
  onClose = vi.fn()
): RenderEditCellProps<CsvGridRow> {
  return {
    column: { key: "c0" },
    onClose,
    onRowChange,
    row: { c0: value, id: 1 },
    rowIdx: 0,
  } as unknown as RenderEditCellProps<CsvGridRow>;
}

afterEach(() => {
  cleanup();
});

describe("CsvCellEditor", () => {
  it("syncs every draft change to RDG before committing", () => {
    const onRowChange = vi.fn();
    render(<CsvCellEditor {...editorProps("a", onRowChange)} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "b" } });
    expect(onRowChange).toHaveBeenLastCalledWith({ c0: "b", id: 1 }, false);

    fireEvent.blur(input);
    expect(onRowChange).toHaveBeenLastCalledWith({ c0: "b", id: 1 }, true);
  });

  it("keeps plain Enter inside a multiline cell", () => {
    const onRowChange = vi.fn();
    const onClose = vi.fn();
    const documentKeyDown = vi.fn();
    const listener = () => documentKeyDown();
    document.addEventListener("keydown", listener);
    render(<CsvCellEditor {...editorProps("a\nb", onRowChange, onClose)} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "a\nb\nc" } });
    onRowChange.mockClear();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(documentKeyDown).not.toHaveBeenCalled();
    expect(onRowChange).not.toHaveBeenCalledWith(expect.anything(), true);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(documentKeyDown).not.toHaveBeenCalled();
    expect(onRowChange).toHaveBeenLastCalledWith(
      { c0: "a\nb\nc", id: 1 },
      true
    );
    document.removeEventListener("keydown", listener);
  });
});
