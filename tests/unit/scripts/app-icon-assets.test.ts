import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { parseIcns } from "../../../scripts/app-icon-icns.mjs";
import {
  assertCompiledIconStack,
  layeredIconFingerprint,
} from "../../../scripts/app-icon-layered.mjs";

const ROOT = process.cwd();
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "pier-icon-assets-"));

function hasCommand(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasRsvgConvert = hasCommand("rsvg-convert");

afterAll(() => {
  rmSync(TEMP_ROOT, { force: true, recursive: true });
});

interface DecodedPng {
  height: number;
  pixels: Buffer;
  width: number;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(data: Buffer): DecodedPng {
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  expect(
    [
      data.readUInt8(24),
      data.readUInt8(25),
      data.readUInt8(26),
      data.readUInt8(27),
      data.readUInt8(28),
    ],
    "icon PNG must be non-interlaced 8-bit RGBA"
  ).toEqual([8, 6, 0, 0, 0]);

  const idat: Buffer[] = [];
  let chunkOffset = 8;
  while (chunkOffset < data.length) {
    const length = data.readUInt32BE(chunkOffset);
    if (data.toString("ascii", chunkOffset + 4, chunkOffset + 8) === "IDAT") {
      idat.push(data.subarray(chunkOffset + 8, chunkOffset + 8 + length));
    }
    chunkOffset += length + 12;
  }

  const rowLength = width * 4;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(rowLength * height);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(rawOffset);
    rawOffset += 1;
    const rowOffset = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const source = raw.readUInt8(rawOffset + x);
      const left = x >= 4 ? pixels.readUInt8(rowOffset + x - 4) : 0;
      const above = y > 0 ? pixels.readUInt8(rowOffset - rowLength + x) : 0;
      const upperLeft =
        y > 0 && x >= 4 ? pixels.readUInt8(rowOffset - rowLength + x - 4) : 0;
      let value = source;
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += above;
      } else if (filter === 3) {
        value += Math.floor((left + above) / 2);
      } else if (filter === 4) {
        value += paeth(left, above, upperLeft);
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
      pixels.writeUInt8(value % 256, rowOffset + x);
    }
    rawOffset += rowLength;
  }
  return { height, pixels, width };
}

function rasterized(source: string, size: number): DecodedPng {
  const output = join(TEMP_ROOT, `${basename(source, ".svg")}-${size}.png`);
  execFileSync("rsvg-convert", [
    "-w",
    String(size),
    "-h",
    String(size),
    "-o",
    output,
    join(ROOT, source),
  ]);
  return decodeRgbaPng(readFileSync(output));
}

function parseIco(data: Buffer): Array<{ png: Buffer; size: number }> {
  expect([data.readUInt16LE(0), data.readUInt16LE(2)]).toEqual([0, 1]);
  const count = data.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const width = data.readUInt8(offset) || 256;
    const height = data.readUInt8(offset + 1) || 256;
    expect(height).toBe(width);
    const length = data.readUInt32LE(offset + 8);
    const payloadOffset = data.readUInt32LE(offset + 12);
    return {
      png: Buffer.from(data.subarray(payloadOffset, payloadOffset + length)),
      size: width,
    };
  });
}

function cornerAlphas(decoded: DecodedPng): number[] {
  const alphaAt = (x: number, y: number) =>
    decoded.pixels.readUInt8((y * decoded.width + x) * 4 + 3);
  return [
    alphaAt(0, 0),
    alphaAt(decoded.width - 1, 0),
    alphaAt(0, decoded.height - 1),
    alphaAt(decoded.width - 1, decoded.height - 1),
  ];
}

const SOURCES = [
  "build/app-icon-master.svg",
  "build/app-icon-small.svg",
  "build/app-icon-tiny.svg",
  "build/design-sources/pier-logo.svg",
] as const;

const LINUX_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512] as const;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const ICNS_PNG_SOURCES = new Map([
  ["ic11", { size: 32, source: "build/app-icon-tiny.svg" }],
  ["ic12", { size: 64, source: "build/app-icon-small.svg" }],
  ["ic07", { size: 128, source: "build/app-icon-small.svg" }],
  ["ic08", { size: 256, source: "build/app-icon-master.svg" }],
  ["ic13", { size: 256, source: "build/app-icon-master.svg" }],
  ["ic09", { size: 512, source: "build/app-icon-master.svg" }],
  ["ic14", { size: 512, source: "build/app-icon-master.svg" }],
  ["ic10", { size: 1024, source: "build/app-icon-master.svg" }],
]);
const EXPECTED_ICNS_PIXEL_HASHES = new Map([
  ["ic11", "2b57cba191c8937bfb782ad3186f56815814c639bdbffd2880e8ff3f704b8957"],
  ["ic12", "d15b57c8e52bc015ba3c99c80be2520a9a88fae23df75c18205f242f1086bb78"],
  ["ic07", "a2e09e45614f7e632085ce96a0f56521b2912f1c5534cc502a00760079dc66a0"],
  ["ic08", "8ba1acd1653c5e2e438a3dbc564cf97e17d517a14eac42979cfc0159972e0c9f"],
  ["ic13", "8ba1acd1653c5e2e438a3dbc564cf97e17d517a14eac42979cfc0159972e0c9f"],
  ["ic09", "d7f26e0c197eb33bda12930c3db51df791d9ab2e38b44e2c59fd3f5d840e3fa8"],
  ["ic14", "d7f26e0c197eb33bda12930c3db51df791d9ab2e38b44e2c59fd3f5d840e3fa8"],
  ["ic10", "da5ac1de85d6a9a3e1d02652f3da3f780913883e9a082a33a9db1b5caa50ae10"],
]);
const SYSTEM_ICONSET_TYPES = new Map<string, string | null>([
  ["icon_16x16.png", null],
  ["icon_16x16@2x.png", "ic11"],
  ["icon_32x32.png", null],
  ["icon_32x32@2x.png", "ic12"],
  ["icon_128x128.png", "ic07"],
  ["icon_128x128@2x.png", "ic13"],
  ["icon_256x256.png", "ic08"],
  ["icon_256x256@2x.png", "ic14"],
  ["icon_512x512.png", "ic09"],
  ["icon_512x512@2x.png", "ic10"],
]);

describe("Pier generated application icon assets", () => {
  it("keeps the design archive grounded in the three canonical renditions", () => {
    const archive = readFileSync(
      join(ROOT, "build/design-sources/index.html"),
      "utf8"
    );
    const imageSources = Array.from(
      archive.matchAll(/<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')/gi),
      (match) => match[1] ?? match[2]
    );
    expect(Array.from(new Set(imageSources)).sort()).toEqual([
      "../app-icon-master.svg",
      "../app-icon-small.svg",
      "../app-icon-tiny.svg",
      "./pier-logo.svg",
    ]);
    expect(archive).not.toMatch(/<\s*(?:svg|path|symbol|script)\b/i);
  });

  it("keeps every canonical source vector-only and locally referenced", () => {
    for (const sourcePath of SOURCES) {
      const source = readFileSync(join(ROOT, sourcePath), "utf8");
      expect(source).not.toMatch(/<(?:image|text)\b/i);
      for (const match of source.matchAll(/\b(?:href|xlink:href)="([^"]+)"/g)) {
        expect(match[1]).toMatch(/^#[A-Za-z][\w:.-]*$/);
      }
    }
  });

  it.runIf(hasRsvgConvert)(
    "publishes the complete master composite as icon.png",
    () => {
      const actual = decodeRgbaPng(readFileSync(join(ROOT, "build/icon.png")));
      const expected = rasterized("build/app-icon-master.svg", 512);
      expect([actual.width, actual.height]).toEqual([512, 512]);
      expect(actual.pixels).toEqual(expected.pixels);
      expect(cornerAlphas(actual)).toEqual([0, 0, 0, 0]);
    }
  );

  it("ships the complete transparent Linux size set", () => {
    expect(readdirSync(join(ROOT, "build/icons")).sort()).toEqual(
      LINUX_SIZES.map((size) => `${String(size)}x${size}.png`).sort()
    );
    for (const size of LINUX_SIZES) {
      const decoded = decodeRgbaPng(
        readFileSync(join(ROOT, "build/icons", `${String(size)}x${size}.png`))
      );
      expect([decoded.width, decoded.height]).toEqual([size, size]);
      expect(cornerAlphas(decoded)).toEqual([0, 0, 0, 0]);
    }
  });

  it("ships Windows frames matching the decoded Linux renditions", () => {
    const frames = parseIco(readFileSync(join(ROOT, "build/icon.ico")));
    expect(frames.map((frame) => frame.size)).toEqual(ICO_SIZES);
    for (const frame of frames) {
      const actual = decodeRgbaPng(frame.png);
      const linux = decodeRgbaPng(
        readFileSync(
          join(ROOT, "build/icons", `${String(frame.size)}x${frame.size}.png`)
        )
      );
      expect(actual.pixels, `${String(frame.size)}px ICO`).toEqual(
        linux.pixels
      );
    }
  });

  it("routes every PNG-backed ICNS frame to the expected optical source", () => {
    const frames = new Map(
      parseIcns(readFileSync(join(ROOT, "build/icon.icns"))).map((entry) => [
        entry.type,
        entry.data,
      ])
    );
    for (const [type, expectedSource] of ICNS_PNG_SOURCES) {
      const frame = frames.get(type);
      expect(frame, `missing ${type}`).toBeDefined();
      const actual = decodeRgbaPng(frame as Buffer);
      expect([actual.width, actual.height]).toEqual([
        expectedSource.size,
        expectedSource.size,
      ]);
      expect(createHash("sha256").update(actual.pixels).digest("hex")).toBe(
        EXPECTED_ICNS_PIXEL_HASHES.get(type)
      );
    }
    expect(decodeRgbaPng(frames.get("ic08") as Buffer).pixels).toEqual(
      decodeRgbaPng(frames.get("ic13") as Buffer).pixels
    );
    expect(decodeRgbaPng(frames.get("ic09") as Buffer).pixels).toEqual(
      decodeRgbaPng(frames.get("ic14") as Buffer).pixels
    );
  });

  it.runIf(process.platform === "darwin")(
    "round-trips every official ICNS slot through iconutil",
    { timeout: 20_000 },
    () => {
      const output = join(TEMP_ROOT, "Pier.iconset");
      execFileSync("iconutil", [
        "--convert",
        "iconset",
        "--output",
        output,
        join(ROOT, "build/icon.icns"),
      ]);
      expect(readdirSync(output).sort()).toEqual(
        Array.from(SYSTEM_ICONSET_TYPES.keys()).sort()
      );
      const frames = new Map(
        parseIcns(readFileSync(join(ROOT, "build/icon.icns"))).map((entry) => [
          entry.type,
          entry.data,
        ])
      );
      for (const [file, sourceType] of SYSTEM_ICONSET_TYPES) {
        const actual = decodeRgbaPng(readFileSync(join(output, file)));
        expect(cornerAlphas(actual), file).toEqual([0, 0, 0, 0]);
        if (sourceType) {
          const source = frames.get(sourceType);
          expect(source, `missing ${sourceType}`).toBeDefined();
          expect(actual.pixels, file).toEqual(
            decodeRgbaPng(source as Buffer).pixels
          );
        }
      }
    }
  );

  it.runIf(process.platform === "darwin")(
    "ships a complete and fresh native three-layer vector catalog",
    () => {
      const car = join(ROOT, "build/Assets.car");
      expect(existsSync(car)).toBe(true);
      expect(readFileSync(car).toString("ascii", 0, 8)).toBe("BOMStore");
      expect(() => assertCompiledIconStack(car)).not.toThrow();
      expect(readFileSync(join(ROOT, "build/Assets.car.inputs"), "utf8")).toBe(
        layeredIconFingerprint(join(ROOT, "build/app-icon.icon"))
      );
    }
  );
});
