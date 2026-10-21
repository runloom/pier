import {
  applyCsvEdits,
  csvCellEdit,
  csvColumnDeleteEdit,
  csvColumnInsertEdit,
  csvMatrixEdits,
  csvRowDeleteEdit,
  csvRowInsertEdit,
  invertCsvEdits,
} from "@plugins/builtin/files/renderer/preview/csv/edit.ts";
import { parseCsv } from "@plugins/builtin/files/renderer/preview/csv/parser.ts";
import { describe, expect, it } from "vitest";

const editText = (
  text: string,
  edits: ReturnType<typeof csvCellEdit>
): string => applyCsvEdits(text, edits);

describe("csv cell edits", () => {
  it("replaces only the touched cell and preserves other bytes", () => {
    const text = "a,b\n1,2\n";
    const table = parseCsv(text, ",");
    expect(editText(text, csvCellEdit(table, 1, 0, "3"))).toBe("a,b\n3,2\n");
  });

  it("quotes only when the new value needs it", () => {
    const text = "a,b\n1,2\n";
    const table = parseCsv(text, ",");
    expect(editText(text, csvCellEdit(table, 1, 0, "x,y"))).toBe(
      'a,b\n"x,y",2\n'
    );
    expect(editText(text, csvCellEdit(table, 1, 0, 'x"y'))).toBe(
      'a,b\n"x""y",2\n'
    );
  });

  it("keeps the original quoting style on a quoted cell", () => {
    const text = 'a,b\n"1",2\n';
    const table = parseCsv(text, ",");
    expect(editText(text, csvCellEdit(table, 1, 0, "3"))).toBe('a,b\n"3",2\n');
  });

  it("does not rewrite a cell whose parsed value is unchanged", () => {
    const text = "a, b\n1,2\n";
    const table = parseCsv(text, ",");
    expect(csvCellEdit(table, 0, 1, " b")).toEqual([]);
  });

  it("appends a missing cell to a ragged row", () => {
    const text = "a,b\n1,2";
    const table = parseCsv(text, ",");
    expect(editText(text, csvCellEdit(table, 1, 3, "4"))).toBe("a,b\n1,2,,4");
  });
});

describe("csv row edits", () => {
  it("inserts a row in the middle", () => {
    const text = "a,b\n1,2\n";
    const table = parseCsv(text, ",");
    expect(editText(text, csvRowInsertEdit(table, 1, ["x", "y"]))).toBe(
      "a,b\nx,y\n1,2\n"
    );
  });

  it("appends a row and keeps the trailing-EOL style", () => {
    const withEol = "a,b\n1,2\n";
    expect(
      editText(withEol, csvRowInsertEdit(parseCsv(withEol, ","), 2, ["x", "y"]))
    ).toBe("a,b\n1,2\nx,y\n");
    const withoutEol = "a,b\n1,2";
    expect(
      editText(
        withoutEol,
        csvRowInsertEdit(parseCsv(withoutEol, ","), 2, ["x", "y"])
      )
    ).toBe("a,b\n1,2\nx,y");
  });

  it("materializes an empty one-column row", () => {
    expect(editText("", csvRowInsertEdit(parseCsv("", ","), 0, [""]))).toBe(
      "\n"
    );
    expect(editText("a", csvRowInsertEdit(parseCsv("a", ","), 1, [""]))).toBe(
      "a\n\n"
    );
    expect(
      editText("a\n", csvRowInsertEdit(parseCsv("a\n", ","), 1, [""]))
    ).toBe("a\n\n");
  });

  it("deletes middle and final rows", () => {
    const text = "a,b\n1,2\n3,4\n";
    expect(editText(text, csvRowDeleteEdit(parseCsv(text, ","), 1))).toBe(
      "a,b\n3,4\n"
    );
    const noEol = "a,b\n1,2";
    expect(editText(noEol, csvRowDeleteEdit(parseCsv(noEol, ","), 1))).toBe(
      "a,b"
    );
  });
});

describe("csv column edits", () => {
  it("inserts a column across the header and data", () => {
    const text = "a,b\n1,2\n";
    expect(
      editText(text, csvColumnInsertEdit(parseCsv(text, ","), 1, "c"))
    ).toBe("a,c,b\n1,,2\n");
  });

  it("deletes a column across rows", () => {
    const text = "a,b\n1,2\n";
    expect(editText(text, csvColumnDeleteEdit(parseCsv(text, ","), 1))).toBe(
      "a\n1\n"
    );
  });

  it("undoes multi-edit column changes in post-edit coordinates", () => {
    const text = "a,b\n1,2\n";
    const table = parseCsv(text, ",");
    const deleted = applyCsvEdits(text, csvColumnDeleteEdit(table, 1));
    expect(
      applyCsvEdits(
        deleted,
        invertCsvEdits(text, csvColumnDeleteEdit(table, 1))
      )
    ).toBe(text);
    const inserted = applyCsvEdits(text, csvColumnInsertEdit(table, 1, "c"));
    expect(
      applyCsvEdits(
        inserted,
        invertCsvEdits(text, csvColumnInsertEdit(table, 1, "c"))
      )
    ).toBe(text);
  });
});

describe("matrix diff and undo", () => {
  it("converts a changed matrix into a minimal cell edit", () => {
    const text = "a,b\n1,2\n";
    const table = parseCsv(text, ",");
    const edits = csvMatrixEdits(table, [
      ["a", "b"],
      ["1", "3"],
    ]);
    expect(edits).toHaveLength(1);
    expect(applyCsvEdits(text, edits)).toBe("a,b\n1,3\n");
  });

  it("appends new rows in order", () => {
    const text = "a,b\n1,2";
    const table = parseCsv(text, ",");
    const edits = csvMatrixEdits(table, [
      ["a", "b"],
      ["1", "2"],
      ["x", "y"],
      ["z", "w"],
    ]);
    expect(applyCsvEdits(text, edits)).toBe("a,b\n1,2\nx,y\nz,w");
  });

  it("does not pad untouched ragged rows", () => {
    const text = "a,b,c\n1,2\n";
    const table = parseCsv(text, ",");
    const edits = csvMatrixEdits(table, [
      ["a", "b", "c"],
      ["1", "2", ""],
      ["x", "", ""],
    ]);
    expect(applyCsvEdits(text, edits)).toBe("a,b,c\n1,2\nx,,\n");
  });

  it("applies cell and trailing-row inserts at the same offset in order", () => {
    const text = "a,b\n1";
    const table = parseCsv(text, ",");
    const edits = csvMatrixEdits(table, [
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(applyCsvEdits(text, edits)).toBe("a,b\n1,2\n3,4");
  });

  it("inverts an edit and restores the original bytes", () => {
    const text = "a,b\n1,2\n";
    const table = parseCsv(text, ",");
    const edits = csvCellEdit(table, 1, 1, "9");
    const next = applyCsvEdits(text, edits);
    expect(applyCsvEdits(next, invertCsvEdits(text, edits))).toBe(text);
  });
});
