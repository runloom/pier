/**
 * LSP stdio framing: Content-Length headers + JSON body (no Content-Type required).
 * Transport for @codemirror/lsp-client speaks bare JSON strings; this codec is the
 * boundary between Node child-process bytes and those JSON messages.
 */

const HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "ascii");
const CONTENT_LENGTH_HEADER = "content-length";

export const LSP_MAX_HEADER_BYTES = 8 * 1024;
export const LSP_MAX_CONTENT_BYTES = 4 * 1024 * 1024;
export const LSP_MAX_BUFFER_BYTES =
  LSP_MAX_HEADER_BYTES + LSP_MAX_CONTENT_BYTES;

export type LspFramingErrorCode =
  | "header-too-large"
  | "invalid-header"
  | "duplicate-content-length"
  | "content-too-large"
  | "buffer-too-large"
  | "invalid-utf8";

export class LspFramingError extends Error {
  readonly code: LspFramingErrorCode;

  constructor(code: LspFramingErrorCode) {
    super(code);
    this.name = "LspFramingError";
    this.code = code;
  }
}

interface ByteSlice {
  readonly buffer: ArrayBufferLike;
  byteLength: number;
  readonly byteOffset: number;
}

function appendSlice(
  slices: ByteSlice[],
  chunk: Buffer,
  start: number,
  end: number
): void {
  if (start === end) {
    return;
  }

  const byteOffset = chunk.byteOffset + start;
  const byteLength = end - start;
  const previous = slices.at(-1);
  if (
    previous?.buffer === chunk.buffer &&
    previous.byteOffset + previous.byteLength === byteOffset
  ) {
    previous.byteLength += byteLength;
    return;
  }

  if (chunk.buffer.byteLength > LSP_MAX_BUFFER_BYTES) {
    const copy = Buffer.from(chunk.subarray(start, end));
    slices.push({
      buffer: copy.buffer,
      byteLength: copy.byteLength,
      byteOffset: copy.byteOffset,
    });
    return;
  }

  slices.push({ buffer: chunk.buffer, byteLength, byteOffset });
}

function materializeSlices(
  slices: readonly ByteSlice[],
  byteLength: number
): Buffer {
  const first = slices[0];
  if (first && slices.length === 1) {
    return Buffer.from(first.buffer, first.byteOffset, first.byteLength);
  }

  const result = Buffer.allocUnsafe(byteLength);
  let writeOffset = 0;
  for (const slice of slices) {
    const source = Buffer.from(
      slice.buffer,
      slice.byteOffset,
      slice.byteLength
    );
    writeOffset += source.copy(result, writeOffset);
  }
  return result;
}

export function encodeLspMessage(jsonBody: string): Buffer {
  const body = Buffer.from(jsonBody, "utf8");
  const header = Buffer.from(
    `Content-Length: ${body.byteLength}\r\n\r\n`,
    "utf8"
  );
  return Buffer.concat([header, body]);
}

export class LspMessageReader {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  #bodyBytes = 0;
  #bodyLength: number | null = null;
  #bodySlices: ByteSlice[] = [];
  #fatalError: LspFramingError | null = null;
  #frameHeaderBytes = 0;
  #headerBytes = 0;
  #headerMatchBytes = 0;
  #headerSlices: ByteSlice[] = [];

  push(chunk: Buffer): string[] {
    if (this.#fatalError) {
      throw this.#fatalError;
    }

    const messages: string[] = [];
    let offset = 0;

    while (offset < chunk.byteLength) {
      if (this.#bodyLength === null) {
        offset = this.#consumeHeader(chunk, offset, messages);
      } else {
        offset = this.#consumeBody(chunk, offset, messages);
      }
    }

    return messages;
  }

  #consumeHeader(
    chunk: Buffer,
    initialOffset: number,
    messages: string[]
  ): number {
    let offset = initialOffset;
    const start = offset;

    while (offset < chunk.byteLength) {
      const byte = chunk[offset];
      if (byte === undefined) {
        break;
      }
      if (byte > 0x7f) {
        this.#fail("invalid-header");
      }

      this.#headerBytes += 1;
      if (this.#headerBytes > LSP_MAX_HEADER_BYTES) {
        this.#fail("header-too-large");
      }

      if (byte === HEADER_SEPARATOR[this.#headerMatchBytes]) {
        this.#headerMatchBytes += 1;
      } else {
        this.#headerMatchBytes = byte === HEADER_SEPARATOR[0] ? 1 : 0;
      }
      offset += 1;

      if (this.#headerMatchBytes !== HEADER_SEPARATOR.byteLength) {
        continue;
      }

      appendSlice(this.#headerSlices, chunk, start, offset);
      const contentLength = this.#parseHeader();
      this.#bodyLength = contentLength;
      this.#frameHeaderBytes = this.#headerBytes;
      this.#headerBytes = 0;
      this.#headerMatchBytes = 0;
      this.#headerSlices = [];

      if (contentLength === 0) {
        messages.push("");
        this.#resetFrame();
      }
      return offset;
    }

    appendSlice(this.#headerSlices, chunk, start, offset);
    return offset;
  }

  #consumeBody(
    chunk: Buffer,
    initialOffset: number,
    messages: string[]
  ): number {
    let offset = initialOffset;
    const bodyLength = this.#bodyLength;
    if (bodyLength === null) {
      return offset;
    }

    const consumed = Math.min(
      bodyLength - this.#bodyBytes,
      chunk.byteLength - offset
    );
    appendSlice(this.#bodySlices, chunk, offset, offset + consumed);
    this.#bodyBytes += consumed;
    offset += consumed;

    if (this.#frameHeaderBytes + this.#bodyBytes > LSP_MAX_BUFFER_BYTES) {
      this.#fail("buffer-too-large");
    }
    if (this.#bodyBytes !== bodyLength) {
      return offset;
    }

    const body = materializeSlices(this.#bodySlices, this.#bodyBytes);
    let message: string;
    try {
      message = this.#decoder.decode(body);
    } catch {
      this.#fail("invalid-utf8");
    }

    messages.push(message);
    this.#resetFrame();
    return offset;
  }

  #parseHeader(): number {
    const header = materializeSlices(this.#headerSlices, this.#headerBytes);
    const headerText = header
      .subarray(0, header.byteLength - HEADER_SEPARATOR.byteLength)
      .toString("ascii");
    const lines = headerText.split("\r\n");
    let contentLength: number | null = null;

    for (const line of lines) {
      const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):([\t\x20-\x7e]*)$/.exec(
        line
      );
      if (!match?.[1] || match[2] === undefined) {
        this.#fail("invalid-header");
      }

      if (match[1].toLowerCase() !== CONTENT_LENGTH_HEADER) {
        continue;
      }
      if (contentLength !== null) {
        this.#fail("duplicate-content-length");
      }

      const valueMatch = /^[\t ]*(\d+)[\t ]*$/.exec(match[2]);
      const decimal = valueMatch?.[1];
      if (!decimal) {
        this.#fail("invalid-header");
      }

      const parsed = Number(decimal);
      if (!Number.isSafeInteger(parsed)) {
        this.#fail("invalid-header");
      }
      contentLength = parsed;
    }

    if (contentLength === null) {
      this.#fail("invalid-header");
    }
    if (contentLength > LSP_MAX_CONTENT_BYTES) {
      this.#fail("content-too-large");
    }
    if (this.#headerBytes + contentLength > LSP_MAX_BUFFER_BYTES) {
      this.#fail("buffer-too-large");
    }
    return contentLength;
  }

  #resetFrame(): void {
    this.#bodyBytes = 0;
    this.#bodyLength = null;
    this.#bodySlices = [];
    this.#frameHeaderBytes = 0;
  }

  #fail(code: LspFramingErrorCode): never {
    const error = new LspFramingError(code);
    this.#bodyBytes = 0;
    this.#bodyLength = null;
    this.#bodySlices = [];
    this.#frameHeaderBytes = 0;
    this.#headerBytes = 0;
    this.#headerMatchBytes = 0;
    this.#headerSlices = [];
    this.#fatalError = error;
    throw error;
  }
}
