import { describe, expect, it } from "vitest";
import {
  encodeLspMessage,
  LSP_MAX_BUFFER_BYTES,
  LSP_MAX_CONTENT_BYTES,
  LSP_MAX_HEADER_BYTES,
  LspFramingError,
  LspMessageReader,
} from "../../../src/main/services/lsp/lsp-message-codec.ts";

function frame(
  headerLines: readonly string[],
  body: Buffer = Buffer.alloc(0)
): Buffer {
  return Buffer.concat([
    Buffer.from(`${headerLines.join("\r\n")}\r\n\r\n`, "utf8"),
    body,
  ]);
}

function zeroLengthFrameWithHeaderBytes(byteLength: number): Buffer {
  const prefix = "Content-Length: 0\r\nX-Padding: ";
  const suffix = "\r\n\r\n";
  const paddingLength =
    byteLength - Buffer.byteLength(prefix, "ascii") - suffix.length;
  return Buffer.from(`${prefix}${"x".repeat(paddingLength)}${suffix}`, "ascii");
}

function expectFramingError(
  chunk: Buffer,
  code: LspFramingError["code"]
): void {
  let thrown: unknown;
  try {
    new LspMessageReader().push(chunk);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LspFramingError);
  expect(thrown).toMatchObject({ code });
}

describe("encodeLspMessage", () => {
  it("prefixes JSON with Content-Length header", () => {
    const body = '{"jsonrpc":"2.0","id":1,"method":"initialize"}';
    const encoded = encodeLspMessage(body);
    expect(encoded.toString("utf8")).toBe(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
    );
  });
});

describe("LspMessageReader", () => {
  it("parses a single framed message", () => {
    const reader = new LspMessageReader();
    const body = '{"jsonrpc":"2.0","id":1,"result":null}';
    const framed = encodeLspMessage(body);
    expect(reader.push(framed)).toEqual([body]);
  });

  it("parses a frame from independently backed one-byte chunks", () => {
    const reader = new LspMessageReader();
    const body = "x".repeat(128 * 1024);
    const framed = encodeLspMessage(body);
    const messages: string[] = [];

    for (let offset = 0; offset < framed.length; offset += 1) {
      const fragment = Buffer.from(
        Uint8Array.of(framed.readUInt8(offset)).buffer
      );
      messages.push(...reader.push(fragment));
    }

    expect(messages).toEqual([body]);
  });

  it("parses concatenated frames whose chunk exceeds the buffer bound", () => {
    const reader = new LspMessageReader();
    const bodyLength = Math.floor(LSP_MAX_BUFFER_BYTES / 2) + 1;
    const firstBody = "a".repeat(bodyLength);
    const secondBody = "b".repeat(bodyLength);
    const chunk = Buffer.concat([
      encodeLspMessage(firstBody),
      encodeLspMessage(secondBody),
    ]);
    expect(chunk.byteLength).toBeGreaterThan(LSP_MAX_BUFFER_BYTES);
    expect(reader.push(chunk)).toEqual([firstBody, secondBody]);
  });

  it("enforces the inclusive header byte bound", () => {
    expect(LSP_MAX_HEADER_BYTES).toBe(8 * 1024);
    expect(
      new LspMessageReader().push(
        zeroLengthFrameWithHeaderBytes(LSP_MAX_HEADER_BYTES)
      )
    ).toEqual([""]);
    expectFramingError(
      zeroLengthFrameWithHeaderBytes(LSP_MAX_HEADER_BYTES + 1),
      "header-too-large"
    );
  });

  it("enforces the inclusive body byte bound before buffering the body", () => {
    expect(LSP_MAX_CONTENT_BYTES).toBe(4 * 1024 * 1024);
    const body = Buffer.alloc(LSP_MAX_CONTENT_BYTES, 0x61);
    const [message] = new LspMessageReader().push(
      frame([`Content-Length: ${body.byteLength}`], body)
    );

    expect(Buffer.byteLength(message ?? "", "utf8")).toBe(
      LSP_MAX_CONTENT_BYTES
    );
    expectFramingError(
      frame([`Content-Length: ${LSP_MAX_CONTENT_BYTES + 1}`]),
      "content-too-large"
    );
  });

  it("rejects repeated Content-Length headers case-insensitively", () => {
    expectFramingError(
      frame(["Content-Length: 0", "content-length: 0"]),
      "duplicate-content-length"
    );
  });

  it.each([
    ["missing Content-Length", ["Content-Type: application/json"]],
    ["a negative Content-Length", ["Content-Length: -1"]],
    ["a non-decimal Content-Length", ["Content-Length: 1.5"]],
    [
      "an unsafe Content-Length integer",
      [`Content-Length: ${Number.MAX_SAFE_INTEGER + 1}`],
    ],
    ["a header line without a colon", ["Content-Length 0"]],
    ["whitespace before the header colon", ["Content-Length : 0"]],
    ["a non-ASCII header", ["Content-Length: 0", "X-Description: café"]],
  ])("rejects %s", (_label, headerLines) => {
    expectFramingError(frame(headerLines), "invalid-header");
  });

  it("rejects invalid UTF-8 bodies without replacement decoding", () => {
    expectFramingError(
      frame(["Content-Length: 2"], Buffer.from([0xc3, 0x28])),
      "invalid-utf8"
    );
  });

  it("does not apply the buffer bound to bytes from completed frames", () => {
    expect(LSP_MAX_BUFFER_BYTES).toBe(
      LSP_MAX_HEADER_BYTES + LSP_MAX_CONTENT_BYTES
    );
    const reader = new LspMessageReader();
    const body = "x".repeat(1024);
    const framed = encodeLspMessage(body);
    const frameCount = Math.ceil((LSP_MAX_BUFFER_BYTES + 1) / framed.length);
    let received = 0;

    for (let index = 0; index < frameCount; index += 1) {
      const messages = reader.push(framed);
      if (messages.length === 1 && messages[0] === body) {
        received += 1;
      }
    }

    expect(frameCount * framed.length).toBeGreaterThan(LSP_MAX_BUFFER_BYTES);
    expect(received).toBe(frameCount);
  });
});
