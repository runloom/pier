import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  encodeIcns,
  ICNS_DIMENSIONS,
  mergeIcnsRenditions,
  parseIcns,
} from "../../../scripts/app-icon-icns.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MICRO_TYPES = new Set(["icp4", "icp5", "icp6", "ic07", "ic11", "ic12"]);
const LEGACY_TYPES = ["is32", "s8mk", "il32", "l8mk"] as const;
const RETINA_SOURCE_TYPES = new Map([
  ["ic13", "ic08"],
  ["ic14", "ic09"],
]);
const COMPRESSED_RGBA_SCANLINES = new Map<number, Buffer>();

function pngChunk(
  type: string,
  data: Buffer<ArrayBufferLike> = Buffer.alloc(0)
): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length
  );
  return chunk;
}

function compressedRgbaScanlines(size: number): Buffer {
  const cached = COMPRESSED_RGBA_SCANLINES.get(size);
  if (cached) {
    return cached;
  }
  const compressed = deflateSync(Buffer.alloc((size * 4 + 1) * size));
  COMPRESSED_RGBA_SCANLINES.set(size, compressed);
  return compressed;
}

function png(
  size: number,
  marker: string,
  options: { bitDepth?: number; colorType?: number; scanlines?: Buffer } = {}
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([options.bitDepth ?? 8, options.colorType ?? 6, 0, 0, 0], 8);

  const imageData = options.scanlines
    ? deflateSync(options.scanlines)
    : compressedRgbaScanlines(size);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`marker\0${marker}`)),
    pngChunk("IDAT", imageData),
    pngChunk("IEND"),
  ]);
}

function pngMarker(data: Buffer): string | undefined {
  let offset = PNG_SIGNATURE.length;
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (type === "tEXt") {
      return data
        .toString("utf8", offset + 8, offset + 8 + length)
        .split("\0")[1];
    }
    offset += 12 + length;
  }
  return;
}

function rendition(label: string): Buffer {
  return encodeIcns(
    Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
      type,
      data: png(size, `${type}-${label}`),
    }))
  );
}

function legacy16(): Buffer {
  return encodeIcns([
    { type: "is32", data: legacyRgb(16) },
    { type: "s8mk", data: Buffer.alloc(16 * 16) },
  ]);
}

function legacy32(): Buffer {
  return encodeIcns([
    { type: "il32", data: legacyRgb(32) },
    { type: "l8mk", data: Buffer.alloc(32 * 32) },
  ]);
}

function legacyRgb(size: number): Buffer {
  const channel: number[] = [];
  let remaining = size * size;
  while (remaining > 0) {
    const count = Math.min(130, remaining);
    channel.push(count + 125, 0);
    remaining -= count;
  }
  return Buffer.from([...channel, ...channel, ...channel]);
}

describe("Pier ICNS rendition merger", () => {
  it("selects Micro through 128px and Standard from 256px", () => {
    const result = parseIcns(
      mergeIcnsRenditions(
        rendition("standard"),
        rendition("micro"),
        legacy16(),
        legacy32()
      )
    );

    expect(result.map((entry) => entry.type)).toEqual([
      ...LEGACY_TYPES,
      ...Object.keys(ICNS_DIMENSIONS),
    ]);
    for (const entry of result) {
      if (LEGACY_TYPES.includes(entry.type as (typeof LEGACY_TYPES)[number])) {
        continue;
      }
      const sourceType = RETINA_SOURCE_TYPES.get(entry.type) ?? entry.type;
      const label = MICRO_TYPES.has(entry.type) ? "micro" : "standard";
      expect(pngMarker(entry.data)).toBe(`${sourceType}-${label}`);
    }
  });

  it("uses the official Retina pixel dimensions", () => {
    expect(ICNS_DIMENSIONS.ic13).toBe(256);
    expect(ICNS_DIMENSIONS.ic14).toBe(512);
  });

  it("rejects malformed ICNS headers and declared lengths", () => {
    expect(() => parseIcns(Buffer.from("not-icns"))).toThrow(/ICNS header/);

    const valid = rendition("valid");
    valid.writeUInt32BE(valid.length + 8, 4);
    expect(() => parseIcns(valid)).toThrow(/declared length/);
  });

  it("rejects duplicate ICNS entry types", () => {
    expect(() =>
      encodeIcns([
        { type: "icp4", data: png(16, "first") },
        { type: "icp4", data: png(16, "second") },
      ])
    ).toThrow(/duplicate icp4/);
  });

  it("rejects corrupt or truncated PNG payloads", () => {
    const corruptCrc = png(16, "crc");
    corruptCrc[corruptCrc.length - 1] = Number(corruptCrc.at(-1) === 0);
    expect(() =>
      parseIcns(encodeIcns([{ type: "icp4", data: corruptCrc }]))
    ).toThrow(/CRC/);

    const missingIend = png(16, "iend").subarray(0, -12);
    expect(() =>
      parseIcns(encodeIcns([{ type: "icp4", data: missingIend }]))
    ).toThrow(/IEND/);

    const truncated = png(16, "truncated").subarray(0, -1);
    expect(() =>
      parseIcns(encodeIcns([{ type: "icp4", data: truncated }]))
    ).toThrow(/truncated/i);
  });

  it("rejects PNG payloads with invalid RGBA scanline layouts", () => {
    const shortScanlines = png(16, "short", {
      scanlines: Buffer.from([0]),
    });
    expect(() =>
      parseIcns(encodeIcns([{ type: "icp4", data: shortScanlines }]))
    ).toThrow(/scanline length/i);

    const invalidMetadata = png(16, "metadata", { bitDepth: 1 });
    expect(() =>
      parseIcns(encodeIcns([{ type: "icp4", data: invalidMetadata }]))
    ).toThrow(/8-bit RGBA/i);

    const scanlines = Buffer.alloc((16 * 4 + 1) * 16);
    scanlines.writeUInt8(5, 0);
    const invalidFilter = png(16, "filter", { scanlines });
    expect(() =>
      parseIcns(encodeIcns([{ type: "icp4", data: invalidFilter }]))
    ).toThrow(/filter/i);
  });

  it("rejects a selected PNG whose size disagrees with its ICNS type", () => {
    const wrongStandard = encodeIcns(
      Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
        type,
        data: png(type === "ic08" ? 128 : size, `${type}-wrong`),
      }))
    );

    expect(() =>
      mergeIcnsRenditions(
        wrongStandard,
        rendition("micro"),
        legacy16(),
        legacy32()
      )
    ).toThrow(/ic08.*256/);
  });

  it("rejects a rendition with a required entry missing", () => {
    const incomplete = encodeIcns(
      Object.entries(ICNS_DIMENSIONS)
        .filter(([type]) => type !== "ic09")
        .map(([type, size]) => ({
          type,
          data: png(size, `${type}-incomplete`),
        }))
    );

    expect(() =>
      mergeIcnsRenditions(
        incomplete,
        rendition("micro"),
        legacy16(),
        legacy32()
      )
    ).toThrow(/missing ic09/);
  });

  it("requires the official legacy RGB and alpha entries for non-Retina frames", () => {
    const missingAlpha = encodeIcns([{ type: "is32", data: legacyRgb(16) }]);
    expect(() =>
      mergeIcnsRenditions(
        rendition("standard"),
        rendition("micro"),
        missingAlpha,
        legacy32()
      )
    ).toThrow(/missing s8mk/);

    const wrongMask = encodeIcns([
      { type: "is32", data: legacyRgb(16) },
      { type: "s8mk", data: Buffer.alloc(10) },
    ]);
    expect(() => parseIcns(wrongMask)).toThrow(/s8mk.*256/);

    const truncatedRgb = encodeIcns([
      { type: "is32", data: legacyRgb(16).subarray(0, -1) },
    ]);
    expect(() => parseIcns(truncatedRgb)).toThrow(/is32.*truncated/);

    const trailingRgb = encodeIcns([
      { type: "is32", data: Buffer.concat([legacyRgb(16), Buffer.from([0])]) },
    ]);
    expect(() => parseIcns(trailingRgb)).toThrow(/is32.*trailing/);
  });
});
