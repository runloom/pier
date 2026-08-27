import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "pier-canonical-icon-test-"));

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

function decodedRgba(data: Buffer): Buffer {
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
    "fixture must be non-interlaced 8-bit RGBA PNG"
  ).toEqual([8, 6, 0, 0, 0]);

  const idatChunks: Buffer[] = [];
  let chunkOffset = 8;
  while (chunkOffset < data.length) {
    const length = data.readUInt32BE(chunkOffset);
    const type = data.toString("ascii", chunkOffset + 4, chunkOffset + 8);
    if (type === "IDAT") {
      idatChunks.push(data.subarray(chunkOffset + 8, chunkOffset + 8 + length));
    }
    chunkOffset += length + 12;
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(rowLength * height);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(rawOffset);
    rawOffset += 1;
    const rowOffset = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const source = raw.readUInt8(rawOffset + x);
      const left =
        x >= bytesPerPixel
          ? pixels.readUInt8(rowOffset + x - bytesPerPixel)
          : 0;
      const above = y > 0 ? pixels.readUInt8(rowOffset - rowLength + x) : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels.readUInt8(rowOffset - rowLength + x - bytesPerPixel)
          : 0;
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
  return pixels;
}

function rasterPixelHash(source: string, size: number): string {
  const output = join(TEMP_ROOT, `${source.replaceAll("/", "-")}-${size}.png`);
  execFileSync("rsvg-convert", [
    "-w",
    String(size),
    "-h",
    String(size),
    "-o",
    output,
    join(ROOT, source),
  ]);
  return createHash("sha256")
    .update(decodedRgba(readFileSync(output)))
    .digest("hex");
}

const APPROVED_RENDITIONS = [
  {
    source: "build/app-icon-master.svg",
    sizes: new Map([
      [
        1024,
        "0f2e4802e2a0f2df9dbd2ba918146b4e15993cd1cd71962a122bb917d877390e",
      ],
      [512, "681a989ea391e5957b6df48c63a10fc744a8d9e299dfcacd49f021ceeac8a287"],
      [256, "3aaff0253ea880382533f3f2ebce57b73ac3c0b3a19935a26132c5f80852dee3"],
    ]),
  },
  {
    source: "build/app-icon-small.svg",
    sizes: new Map([
      [128, "acef017b32336ae045d80bf62033d7742269751de1b10dcee01ec8b058a784d6"],
      [64, "6a06957e188c04e1192a8b30369af48d4f4d4befdfad734da5d12e752340519d"],
    ]),
  },
  {
    source: "build/app-icon-tiny.svg",
    sizes: new Map([
      [32, "433cb8366c8d6632763e8dd87833001038d130d5956354390e9230644f326b6e"],
      [16, "f39b7ec39c9b03819ba758699c7c4ec89ba77613fd4f66425c72e5b5c60ba032"],
    ]),
  },
] as const;

describe("Pier canonical app-icon sources", () => {
  for (const rendition of APPROVED_RENDITIONS) {
    it.runIf(hasRsvgConvert)(
      `${rendition.source} matches its approved decoded pixels`,
      () => {
        const sourceExists = existsSync(join(ROOT, rendition.source));
        expect(sourceExists).toBe(true);
        if (!sourceExists) {
          return;
        }
        for (const [size, approvedHash] of rendition.sizes) {
          expect(rasterPixelHash(rendition.source, size), `${size}px`).toBe(
            approvedHash
          );
        }
      }
    );
  }

  it("preserves the semantic groups needed by the layered macOS icon", () => {
    const source = readFileSync(
      join(ROOT, "build/app-icon-master.svg"),
      "utf8"
    );
    for (const group of [
      "app-icon-plate",
      "bay-surface",
      "bay-inner-rim",
      "terminal-prompt",
    ]) {
      expect(source).toContain(`id="${group}"`);
    }
  });

  it("keeps all canonical sources vector-only and locally referenced", () => {
    for (const rendition of APPROVED_RENDITIONS) {
      const sourcePath = join(ROOT, rendition.source);
      const sourceExists = existsSync(sourcePath);
      expect(sourceExists).toBe(true);
      if (!sourceExists) {
        continue;
      }
      const source = readFileSync(sourcePath, "utf8");
      expect(source).not.toMatch(/<image(?:\s|>)/i);
      expect(source).not.toMatch(/<text(?:\s|>)/i);
      for (const match of source.matchAll(/\b(?:href|xlink:href)="([^"]+)"/g)) {
        expect(match[1]).toMatch(/^#[A-Za-z][\w:.-]*$/);
      }
    }
  });
});
