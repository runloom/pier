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
const RETINA_SOURCE_TYPES = new Map([
  ["ic13", "ic08"],
  ["ic14", "ic09"],
]);

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
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

function png(size: number, marker: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([1, 0, 0, 0, 0], 8);

  const bytesPerRow = Math.ceil(size / 8);
  const scanlines = Buffer.alloc((bytesPerRow + 1) * size);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`marker\0${marker}`)),
    pngChunk("IDAT", deflateSync(scanlines)),
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

describe("Pier ICNS rendition merger", () => {
  it("selects Micro through 128px and Standard from 256px", () => {
    const result = parseIcns(
      mergeIcnsRenditions(rendition("standard"), rendition("micro"))
    );

    expect(result.map((entry) => entry.type)).toEqual(
      Object.keys(ICNS_DIMENSIONS)
    );
    for (const entry of result) {
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

  it("rejects a selected PNG whose size disagrees with its ICNS type", () => {
    const wrongStandard = encodeIcns(
      Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
        type,
        data: png(type === "ic08" ? 128 : size, `${type}-wrong`),
      }))
    );

    expect(() =>
      mergeIcnsRenditions(wrongStandard, rendition("micro"))
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

    expect(() => mergeIcnsRenditions(incomplete, rendition("micro"))).toThrow(
      /missing ic09/
    );
  });
});
