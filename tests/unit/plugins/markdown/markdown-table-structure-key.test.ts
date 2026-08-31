import type {
  MarkdownBlock,
  MarkdownSourceRange,
  MarkdownTableCell,
} from "@plugins/builtin/files/renderer/markdown/ir.ts";
import { tableWidthsKey } from "@plugins/builtin/files/renderer/markdown/table/structure-key.ts";
import { describe, expect, it } from "vitest";

const RANGE: MarkdownSourceRange = {
  endLine: 1,
  endOffset: 1,
  startLine: 1,
  startOffset: 0,
};

function cell(value: string): MarkdownTableCell {
  return {
    children: [{ kind: "text", range: RANGE, value }],
    range: RANGE,
  };
}

function table(
  headers: string[],
  body: string[][] = []
): Extract<MarkdownBlock, { kind: "table" }> {
  return {
    align: headers.map(() => null),
    kind: "table",
    range: RANGE,
    rows: [
      { cells: headers.map(cell), range: RANGE },
      ...body.map((row) => ({ cells: row.map(cell), range: RANGE })),
    ],
  };
}

describe("tableWidthsKey", () => {
  it("is stable across body-cell edits", () => {
    const before = table(["Key", "Value"], [["a", "1"]]);
    const after = table(["Key", "Value"], [["a", "changed"]]);
    expect(tableWidthsKey(before)).toBe(tableWidthsKey(after));
    expect(tableWidthsKey(before)).toEqual(expect.any(String));
  });

  it("changes when a column is added or removed", () => {
    const two = table(["Key", "Value"], [["a", "1"]]);
    const three = table(["Key", "Value", "Note"], [["a", "1", "n"]]);
    const one = table(["Key"], [["a"]]);
    expect(tableWidthsKey(two)).not.toBe(tableWidthsKey(three));
    expect(tableWidthsKey(two)).not.toBe(tableWidthsKey(one));
  });

  it("changes when header order is swapped", () => {
    const ab = table(["Key", "Value"]);
    const ba = table(["Value", "Key"]);
    expect(tableWidthsKey(ab)).not.toBe(tableWidthsKey(ba));
  });

  it("changes when a header is renamed", () => {
    const before = table(["Key", "Value"]);
    const after = table(["Key", "Default"]);
    expect(tableWidthsKey(before)).not.toBe(tableWidthsKey(after));
  });

  it("shares one key across tables with identical headers (documented sharing)", () => {
    // 设计预期：markdown 无稳定表 ID，同文件内同列数同表头的多张表共享
    // 列宽偏好（拖 A 表，同头 B 表经同窗事件同步为相同列宽）。
    const first = table(["Name", "Status"], [["a", "ok"]]);
    const second = table(
      ["Name", "Status"],
      [
        ["b", "fail"],
        ["c", "ok"],
      ]
    );
    expect(tableWidthsKey(first)).toBe(tableWidthsKey(second));
  });

  it("returns null for a table with no header row or no header cells", () => {
    const empty: Extract<MarkdownBlock, { kind: "table" }> = {
      align: [],
      kind: "table",
      range: RANGE,
      rows: [],
    };
    expect(tableWidthsKey(empty)).toBeNull();
    expect(tableWidthsKey(table([]))).toBeNull();
  });
});
