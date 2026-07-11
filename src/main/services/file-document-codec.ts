import { TextDecoder } from "node:util";
import type {
  FileDocumentEol,
  FileDocumentFormat,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
const BINARY_CONTROL_RATIO = 0.1;

export type DecodedFileDocument =
  | {
      contents: string;
      eol: FileDocumentEol;
      format: FileDocumentFormat;
      kind: "text";
    }
  | { kind: "binary" }
  | { kind: "unsupported-encoding" };

export class FileDocumentEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileDocumentEncodingError";
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected file document value: ${String(value)}`);
}

function assertWellFormedUnicode(contents: string): void {
  for (let index = 0; index < contents.length; index += 1) {
    const codeUnit = contents.charCodeAt(index);
    if (codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff) {
      const next = contents.charCodeAt(index + 1);
      if (!(next >= 0xdc_00 && next <= 0xdf_ff)) {
        throw new FileDocumentEncodingError(
          "document contains an unpaired high surrogate"
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff) {
      throw new FileDocumentEncodingError(
        "document contains an unpaired low surrogate"
      );
    }
  }
}

function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return (
    bytes.length >= prefix.length &&
    bytes.subarray(0, prefix.length).equals(prefix)
  );
}

function decodeStrict(bytes: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasBinaryCharacteristics(bytes: Buffer): boolean {
  if (bytes.includes(0)) {
    return true;
  }
  if (bytes.length === 0) {
    return false;
  }
  let controls = 0;
  for (const byte of bytes) {
    const isAllowedWhitespace =
      byte === 0x08 ||
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0c ||
      byte === 0x0d;
    if ((byte < 0x20 && !isAllowedWhitespace) || byte === 0x7f) {
      controls += 1;
    }
  }
  return controls / bytes.length >= BINARY_CONTROL_RATIO;
}

function hasBinaryTextCharacters(contents: string): boolean {
  if (contents.includes("\0")) {
    return true;
  }
  if (contents.length === 0) {
    return false;
  }
  let controls = 0;
  for (const character of contents) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace =
      codePoint === 0x08 ||
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0c ||
      codePoint === 0x0d;
    if ((codePoint < 0x20 && !isAllowedWhitespace) || codePoint === 0x7f) {
      controls += 1;
    }
  }
  return controls / contents.length >= BINARY_CONTROL_RATIO;
}

function looksLikeBomlessUtf16(bytes: Buffer): boolean {
  // 两个 code unit 不足以把 UTF-16 与带 NUL 的二进制可靠区分；至少用
  // 四个 code unit 建立交错 NUL 证据，短样本按二进制处理。
  if (bytes.length < 8 || bytes.length % 2 !== 0) {
    return false;
  }
  let evenNulls = 0;
  let oddNulls = 0;
  const pairs = bytes.length / 2;
  for (let index = 0; index < bytes.length; index += 2) {
    evenNulls += Number(bytes[index] === 0);
    oddNulls += Number(bytes[index + 1] === 0);
  }
  const higherRatio = Math.max(evenNulls, oddNulls) / pairs;
  const lowerRatio = Math.min(evenNulls, oddNulls) / pairs;
  return higherRatio >= 0.3 && lowerRatio <= 0.05;
}

function detectEol(contents: string): FileDocumentEol {
  let cr = 0;
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (character === "\r") {
      if (contents[index + 1] === "\n") {
        crlf += 1;
        index += 1;
      } else {
        cr += 1;
      }
    } else if (character === "\n") {
      lf += 1;
    }
  }
  const kinds = Number(cr > 0) + Number(crlf > 0) + Number(lf > 0);
  if (kinds === 0) {
    return "none";
  }
  if (kinds > 1) {
    return "mixed";
  }
  if (crlf > 0) {
    return "crlf";
  }
  return cr > 0 ? "cr" : "lf";
}

function normalizeEol(contents: string): string {
  return contents.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function textResult(
  contents: string,
  format: FileDocumentFormat
): DecodedFileDocument {
  return {
    contents: normalizeEol(contents),
    eol: detectEol(contents),
    format,
    kind: "text",
  };
}

export function decodeFileDocument(bytes: Buffer): DecodedFileDocument {
  if (startsWith(bytes, UTF8_BOM)) {
    const body = bytes.subarray(UTF8_BOM.length);
    const decoded = decodeStrict(body, "utf-8");
    if (decoded === null) {
      return { kind: "unsupported-encoding" };
    }
    if (hasBinaryCharacteristics(body)) {
      return { kind: "binary" };
    }
    return textResult(decoded, { bom: true, encoding: "utf8" });
  }

  if (startsWith(bytes, UTF16_LE_BOM)) {
    const body = bytes.subarray(UTF16_LE_BOM.length);
    if (body.length % 2 !== 0) {
      return { kind: "unsupported-encoding" };
    }
    const decoded = decodeStrict(body, "utf-16le");
    if (decoded === null) {
      return { kind: "unsupported-encoding" };
    }
    return hasBinaryTextCharacters(decoded)
      ? { kind: "binary" }
      : textResult(decoded, { bom: true, encoding: "utf16le" });
  }

  if (startsWith(bytes, UTF16_BE_BOM)) {
    const body = bytes.subarray(UTF16_BE_BOM.length);
    if (body.length % 2 !== 0) {
      return { kind: "unsupported-encoding" };
    }
    const decoded = decodeStrict(body, "utf-16be");
    if (decoded === null) {
      return { kind: "unsupported-encoding" };
    }
    return hasBinaryTextCharacters(decoded)
      ? { kind: "binary" }
      : textResult(decoded, { bom: true, encoding: "utf16be" });
  }

  const decoded = decodeStrict(bytes, "utf-8");
  if (looksLikeBomlessUtf16(bytes)) {
    return { kind: "unsupported-encoding" };
  }
  if (hasBinaryCharacteristics(bytes)) {
    return { kind: "binary" };
  }
  return decoded === null
    ? { kind: "unsupported-encoding" }
    : textResult(decoded, { bom: false, encoding: "utf8" });
}

function applyEol(contents: string, eol: FileDocumentEol): string {
  switch (eol) {
    case "lf":
    case "none":
      return contents;
    case "crlf":
      return contents.replaceAll("\n", "\r\n");
    case "cr":
      return contents.replaceAll("\n", "\r");
    case "mixed":
      throw new Error("mixed line endings require explicit normalization");
    default:
      return assertNever(eol);
  }
}

export function encodeFileDocument(
  contents: string,
  format: FileDocumentFormat,
  eol: FileDocumentEol | FileWritableDocumentEol
): Buffer {
  assertWellFormedUnicode(contents);
  const withEol = applyEol(contents, eol);
  switch (format.encoding) {
    case "utf8": {
      const body = Buffer.from(withEol, "utf8");
      return format.bom ? Buffer.concat([UTF8_BOM, body]) : body;
    }
    case "utf16le":
      return Buffer.concat([UTF16_LE_BOM, Buffer.from(withEol, "utf16le")]);
    case "utf16be":
      return Buffer.concat([
        UTF16_BE_BOM,
        Buffer.from(withEol, "utf16le").swap16(),
      ]);
    default:
      return assertNever(format);
  }
}
