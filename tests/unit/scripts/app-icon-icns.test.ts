import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  encodeIcns,
  ICNS_DIMENSIONS,
  mergeIcnsRenditions,
  parseIcns,
} from "../../../scripts/app-icon-icns.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MICRO_TYPES = new Set(["icp4", "icp5", "icp6", "ic07", "ic11", "ic12"]);

function png(size: number, marker: number): Buffer {
  const data = Buffer.alloc(25);
  PNG_SIGNATURE.copy(data);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(size, 16);
  data.writeUInt32BE(size, 20);
  data[24] = marker;
  return data;
}

function rendition(marker: number): Buffer {
  return encodeIcns(
    Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
      type,
      data: png(size, marker),
    }))
  );
}

describe("Pier ICNS rendition merger", () => {
  it("selects Micro through 128px and Standard from 256px", () => {
    const result = parseIcns(
      mergeIcnsRenditions(rendition(0xf0), rendition(0x1a))
    );

    expect(result.map((entry) => entry.type)).toEqual(
      Object.keys(ICNS_DIMENSIONS)
    );
    for (const entry of result) {
      expect(entry.data[24]).toBe(MICRO_TYPES.has(entry.type) ? 0x1a : 0xf0);
    }
  });

  it("rejects malformed ICNS headers and declared lengths", () => {
    expect(() => parseIcns(Buffer.from("not-icns"))).toThrow(/ICNS header/);

    const valid = rendition(1);
    valid.writeUInt32BE(valid.length + 8, 4);
    expect(() => parseIcns(valid)).toThrow(/declared length/);
  });

  it("rejects duplicate ICNS entry types", () => {
    expect(() =>
      encodeIcns([
        { type: "icp4", data: png(16, 1) },
        { type: "icp4", data: png(16, 2) },
      ])
    ).toThrow(/duplicate icp4/);
  });

  it("rejects a selected PNG whose size disagrees with its ICNS type", () => {
    const wrongStandard = encodeIcns(
      Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
        type,
        data: png(type === "ic08" ? 128 : size, 1),
      }))
    );

    expect(() => mergeIcnsRenditions(wrongStandard, rendition(2))).toThrow(
      /ic08.*256/
    );
  });

  it("rejects a rendition with a required entry missing", () => {
    const incomplete = encodeIcns(
      Object.entries(ICNS_DIMENSIONS)
        .filter(([type]) => type !== "ic14")
        .map(([type, size]) => ({ type, data: png(size, 1) }))
    );

    expect(() => mergeIcnsRenditions(incomplete, rendition(2))).toThrow(
      /missing ic14/
    );
  });
});
