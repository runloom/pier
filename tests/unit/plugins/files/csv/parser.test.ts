import {
  detectCsvDelimiter,
  parseCsv,
  parseCsvWithDetection,
} from "@plugins/builtin/files/renderer/preview/csv/parser.ts";
import { describe, expect, it } from "vitest";

describe("parseCsv", () => {
  it("records cell spans and line endings", () => {
    const table = parseCsv("a,b\r\n1,2\r\n", ",");
    expect(table.error).toBe(null);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.cells.map((cell) => cell.value)).toEqual(["a", "b"]);
    expect(table.rows[0]?.cells[0]).toMatchObject({ start: 0, end: 1 });
    expect(table.rows[0]?.cells[1]).toMatchObject({ start: 2, end: 3 });
    expect(table.rows[0]).toMatchObject({
      eol: "\r\n",
      eolStart: 3,
      eolEnd: 5,
    });
    expect(table.rows[1]?.cells[0]).toMatchObject({ start: 5, end: 6 });
    expect(table.eol).toBe("\r\n");
  });

  it("decodes quoted delimiters, newlines and escaped quotes", () => {
    const table = parseCsv(
      'name,note\n"Smith, J","line1\nline2"\n"He said ""hi""",x\n',
      ","
    );
    expect(table.error).toBe(null);
    expect(table.rows[1]?.cells[0]?.value).toBe("Smith, J");
    expect(table.rows[1]?.cells[0]?.quoted).toBe(true);
    expect(table.rows[1]?.cells[1]?.value).toBe("line1\nline2");
    expect(table.rows[2]?.cells[0]?.value).toBe('He said "hi"');
  });

  it("keeps a trailing EOL from creating a phantom row", () => {
    expect(parseCsv("a\n", ",").rows).toHaveLength(1);
    expect(parseCsv("a\n\n", ",").rows).toHaveLength(2);
    expect(parseCsv("", ",").rows).toHaveLength(0);
  });

  it("keeps blank rows and ragged rows", () => {
    const table = parseCsv("a,b\n\n1,2,3\n", ",");
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1]?.cells.map((cell) => cell.value)).toEqual([""]);
    expect(table.rows[2]?.cells.map((cell) => cell.value)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(table.columnCount).toBe(3);
  });

  it("strips a BOM while preserving its offset", () => {
    const table = parseCsv("\uFEFFa,b\n", ",");
    expect(table.bomLength).toBe(1);
    expect(table.rows[0]?.cells[0]?.start).toBe(1);
    expect(table.rows[0]?.cells[0]?.value).toBe("a");
  });

  it("records quoted cell bounds", () => {
    const table = parseCsv('a,"b"\r\n', ",");
    expect(table.rows[0]?.cells[1]).toMatchObject({
      end: 5,
      quoted: true,
      start: 2,
      value: "b",
    });
  });

  it("reports an unclosed quote with line and column", () => {
    const table = parseCsv('a,"unterminated\nb', ",");
    expect(table.error).toMatchObject({
      code: "unclosed-quote",
      line: 1,
      column: 3,
    });
  });

  it("counts CR-only line breaks and BOM in error positions", () => {
    expect(parseCsv('a\rb\r"x', ",").error).toMatchObject({
      code: "unclosed-quote",
      line: 3,
      column: 1,
    });
    expect(parseCsv('\uFEFF"x', ",").error).toMatchObject({
      code: "unclosed-quote",
      line: 1,
      column: 1,
    });
  });

  it("reports trailing junk after a closing quote", () => {
    expect(parseCsv('"a"x,b', ",").error).toMatchObject({
      code: "trailing-after-quote",
      line: 1,
      column: 4,
    });
  });
});

describe("detectCsvDelimiter", () => {
  it("prefers tabs for TSV even when prose contains commas", () => {
    expect(detectCsvDelimiter("a\tb\n1,2\t3,4\n", ",")).toBe("\t");
  });

  it("detects semicolon CSV", () => {
    expect(detectCsvDelimiter("a;b\n1;2\n3;4\n", ",")).toBe(";");
  });

  it("keeps semicolon detection stable across trailing EOLs", () => {
    const body = "name;price\nr1;10,50\nr2;20,75";
    expect(detectCsvDelimiter(`${body}\n`, ",")).toBe(";");
    expect(detectCsvDelimiter(body, ",")).toBe(";");
  });

  it("ignores decimal commas when sniffing a semicolon table", () => {
    expect(detectCsvDelimiter("name;price\nr1;10,50\nr2;20,75\n", ",")).toBe(
      ";"
    );
  });

  it("falls back to the extension hint for one-column input", () => {
    expect(detectCsvDelimiter("hello\nworld\n", ";")).toBe(";");
  });

  it("uses the supplied override", () => {
    const table = parseCsvWithDetection("a;b\n1;2\n", "file.csv", ";");
    expect(table.delimiter).toBe(";");
    expect(table.rows[1]?.cells[1]?.value).toBe("2");
  });
});
