import {
  decodeFileDocument,
  encodeFileDocument,
} from "@main/services/file-document-codec.ts";
import { describe, expect, it } from "vitest";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);

describe("file document codec", () => {
  it.each([
    {
      bytes: Buffer.from("first\nsecond\n", "utf8"),
      format: { bom: false as const, encoding: "utf8" as const },
      name: "UTF-8",
    },
    {
      bytes: Buffer.concat([UTF8_BOM, Buffer.from("first\r\nsecond\r\n")]),
      format: { bom: true as const, encoding: "utf8" as const },
      name: "UTF-8 BOM",
    },
    {
      bytes: Buffer.concat([
        UTF16_LE_BOM,
        Buffer.from("first\rsecond\r", "utf16le"),
      ]),
      format: { bom: true as const, encoding: "utf16le" as const },
      name: "UTF-16 LE BOM",
    },
    {
      bytes: Buffer.concat([
        UTF16_BE_BOM,
        Buffer.from("first\nsecond\n", "utf16le").swap16(),
      ]),
      format: { bom: true as const, encoding: "utf16be" as const },
      name: "UTF-16 BE BOM",
    },
  ])("round-trips $name without changing bytes", ({ bytes, format }) => {
    const decoded = decodeFileDocument(bytes);

    expect(decoded).toMatchObject({ kind: "text", format });
    if (decoded.kind !== "text") {
      throw new Error("expected text result");
    }

    expect(
      encodeFileDocument(decoded.contents, decoded.format, decoded.eol)
    ).toEqual(bytes);
  });

  it("normalizes line endings while retaining the original EOL", () => {
    expect(decodeFileDocument(Buffer.from("a\r\nb\r\n"))).toEqual({
      contents: "a\nb\n",
      eol: "crlf",
      format: { bom: false, encoding: "utf8" },
      kind: "text",
    });
    expect(decodeFileDocument(Buffer.from("a\rb\r"))).toMatchObject({
      contents: "a\nb\n",
      eol: "cr",
      kind: "text",
    });
    expect(decodeFileDocument(Buffer.from("a\nb\n"))).toMatchObject({
      eol: "lf",
      kind: "text",
    });
    expect(decodeFileDocument(Buffer.from("plain"))).toMatchObject({
      eol: "none",
      kind: "text",
    });
    expect(decodeFileDocument(Buffer.from("a\r\nb\nc\r"))).toMatchObject({
      eol: "mixed",
      kind: "text",
    });
  });

  it("rejects malformed UTF-16 and unsupported BOM-less UTF-16", () => {
    expect(decodeFileDocument(Buffer.from([0xff, 0xfe, 0x61]))).toMatchObject({
      kind: "unsupported-encoding",
    });
    expect(decodeFileDocument(Buffer.from("hello\n", "utf16le"))).toMatchObject(
      { kind: "unsupported-encoding" }
    );
  });

  it("rejects binary control characters hidden behind a UTF-16 BOM", () => {
    expect(
      decodeFileDocument(
        Buffer.concat([UTF16_LE_BOM, Buffer.from("safe\0payload", "utf16le")])
      )
    ).toEqual({ kind: "binary" });
  });

  it("separates binary data from unknown text encodings", () => {
    expect(
      decodeFileDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))
    ).toEqual({ kind: "binary" });
    expect(decodeFileDocument(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toEqual({
      kind: "unsupported-encoding",
    });
  });

  it("refuses malformed Unicode instead of writing replacement characters", () => {
    expect(() =>
      encodeFileDocument(
        "broken \ud800 text",
        { bom: false, encoding: "utf8" },
        "lf"
      )
    ).toThrow("unpaired high surrogate");
  });
});
