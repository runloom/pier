import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { parseIcns } from "../../../scripts/app-icon-icns.mjs";
import {
  assertCompiledIconStack,
  macIconFingerprint,
} from "../../../scripts/app-icon-layered.mjs";

const ROOT = process.cwd();
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "pier-icon-assets-"));
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const ICNS_PNG_SIZES = new Map([
  ["ic11", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic13", 256],
  ["ic09", 512],
  ["ic14", 512],
  ["ic10", 1024],
]);

interface DecodedPng {
  height: number;
  pixels: Buffer;
  width: number;
}

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

function decodeRgbaPng(data: Buffer): DecodedPng {
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  expect([data.readUInt8(24), data.readUInt8(25), data.readUInt8(28)]).toEqual([
    8, 6, 0,
  ]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < data.length; ) {
    const length = data.readUInt32BE(offset);
    if (data.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      chunks.push(data.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const rowLength = width * 4;
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

function parseIco(data: Buffer) {
  expect([data.readUInt16LE(0), data.readUInt16LE(2)]).toEqual([0, 1]);
  return Array.from({ length: data.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16;
    const size = data.readUInt8(entry) || 256;
    const length = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    return { png: data.subarray(offset, offset + length), size };
  });
}

function cornerAlphas(data: Buffer) {
  const image = decodeRgbaPng(data);
  const alphaAt = (x: number, y: number) =>
    image.pixels.readUInt8((y * image.width + x) * 4 + 3);
  return [
    alphaAt(0, 0),
    alphaAt(image.width - 1, 0),
    alphaAt(0, image.height - 1),
    alphaAt(image.width - 1, image.height - 1),
  ];
}

const ICON_SOURCE = join(ROOT, "build/app-icon-source.svg");
const NIGHT_HARBOR_TRIALS = [
  "night-harbor-deep-water.svg",
  "night-harbor-brand-berth.svg",
  "night-harbor-same-chroma.svg",
] as const;

function svgAttribute(source: string, id: string, attribute: string): string {
  const match = new RegExp(
    `<[^>]*\\bid="${id}"[^>]*\\b${attribute}="([^"]+)"`,
    "i"
  ).exec(source);
  return match?.[1] ?? "";
}

describe("Pier generated application icon assets", () => {
  it("presents the shipping icon against the previous cyan berth", () => {
    const archive = readFileSync(
      join(ROOT, "build/design-sources/index.html"),
      "utf8"
    );
    const sources = Array.from(
      archive.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi),
      (match) => match[1]
    );
    expect(sources[0]).toBe("../icons/512x512.png");
    expect(new Set(sources)).toEqual(
      new Set(["../icons/512x512.png", "./previous-shipping.png"])
    );
    expect(archive).toContain("下载");
    expect(archive).not.toMatch(/<\s*(?:svg|path|symbol|script)\b/i);
    expect(archive).not.toMatch(
      /app-icon-micro|app-icon-master|app-icon-tiny|pier-logo\.svg/
    );
  });

  it("keeps night-harbor color trials on the canonical geometry", () => {
    const source = readFileSync(ICON_SOURCE, "utf8");
    const berth = svgAttribute(source, "pier-berth", "d");
    const chevron = svgAttribute(source, "pier-chevron", "d");
    const underscore = svgAttribute(source, "pier-underscore", "d");
    expect(berth.length).toBeGreaterThan(0);
    for (const file of NIGHT_HARBOR_TRIALS) {
      const trial = readFileSync(
        join(ROOT, "build/design-sources", file),
        "utf8"
      );
      expect(svgAttribute(trial, "pier-berth", "d"), file).toBe(berth);
      expect(svgAttribute(trial, "pier-chevron", "d"), file).toBe(chevron);
      expect(svgAttribute(trial, "pier-underscore", "d"), file).toBe(
        underscore
      );
      expect(trial, file).not.toMatch(/#9bd9ff|#55aef4|#2478ca/i);
      expect(trial, file).toContain("#8549ff");
      expect(trial, file).toContain("#161b28");
    }
  });

  it("publishes the pinned PNG size set and exact 512px container image", () => {
    expect(readdirSync(join(ROOT, "build/icons")).sort()).toEqual(
      ICON_SIZES.map((size) => `${size}x${size}.png`).sort()
    );
    expect(readFileSync(join(ROOT, "build/icon.png"))).toEqual(
      readFileSync(join(ROOT, "build/icons/512x512.png"))
    );
  });

  it("keeps Windows frames pixel-identical to the PNG size set", () => {
    const frames = parseIco(readFileSync(join(ROOT, "build/icon.ico")));
    expect(frames.map(({ size }) => size)).toEqual(ICO_SIZES);
    for (const { png, size } of frames) {
      expect(decodeRgbaPng(png).pixels, `${size}px ICO`).toEqual(
        decodeRgbaPng(
          readFileSync(join(ROOT, "build/icons", `${size}x${size}.png`))
        ).pixels
      );
    }
  });

  it("keeps every generated modern ICNS frame on the canonical resize output", {
    timeout: 20_000,
  }, () => {
    const frames = new Map(
      parseIcns(readFileSync(join(ROOT, "build/icon.icns"))).map((entry) => [
        entry.type,
        entry.data,
      ])
    );
    for (const [type, size] of ICNS_PNG_SIZES) {
      const actual = frames.get(type);
      expect(actual, `missing ${type}`).toBeDefined();
      const decoded = decodeRgbaPng(actual as Buffer);
      expect([decoded.width, decoded.height], type).toEqual([size, size]);
      if (size <= 512) {
        expect(decoded.pixels, type).toEqual(
          decodeRgbaPng(
            readFileSync(join(ROOT, "build/icons", `${size}x${size}.png`))
          ).pixels
        );
      }
    }
  });

  it("keeps every raster output transparent at all four corners", () => {
    for (const size of ICON_SIZES) {
      const corners = cornerAlphas(
        readFileSync(join(ROOT, "build/icons", `${size}x${size}.png`))
      );
      expect(
        corners.every((alpha) => alpha <= 2),
        `${size}px`
      ).toBe(true);
    }
  });

  it.runIf(process.platform === "darwin")(
    "round-trips the complete ICNS through iconutil",
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
      expect(readdirSync(output).sort()).toEqual([
        "icon_128x128.png",
        "icon_128x128@2x.png",
        "icon_16x16.png",
        "icon_16x16@2x.png",
        "icon_256x256.png",
        "icon_256x256@2x.png",
        "icon_32x32.png",
        "icon_32x32@2x.png",
        "icon_512x512.png",
        "icon_512x512@2x.png",
      ]);
      for (const file of readdirSync(output)) {
        expect(cornerAlphas(readFileSync(join(output, file))), file).toEqual([
          0, 0, 0, 0,
        ]);
      }
    }
  );

  it.runIf(process.platform === "darwin")(
    "ships a complete and fresh native single-PNG catalog",
    () => {
      const car = join(ROOT, "build/Assets.car");
      expect(existsSync(car)).toBe(true);
      expect(readFileSync(car).toString("ascii", 0, 8)).toBe("BOMStore");
      expect(() => assertCompiledIconStack(car)).not.toThrow();
      expect(readFileSync(join(ROOT, "build/Assets.car.inputs"), "utf8")).toBe(
        macIconFingerprint(
          join(ROOT, "build/app-icon-source.svg"),
          parseIcns(readFileSync(join(ROOT, "build/icon.icns"))).find(
            ({ type }) => type === "ic10"
          )?.data as Buffer
        )
      );
    }
  );
});
