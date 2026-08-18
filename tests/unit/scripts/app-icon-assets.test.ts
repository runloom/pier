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
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseIcns } from "../../../scripts/app-icon-icns.mjs";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const EXPECTED_ICNS_FRAME_HASHES = {
  ic07: "7dec7fb7f242df8bdb3e000bcdffec15ec9d2038ccafed56485048d23794e810",
  ic08: "3ac2359a170e8587af35b7570a80671991c2a62983ec48eec9497de0805685ff",
  ic09: "990d6282d5fb4ad596f773899c8e948f4dba0d8de793c2c26857488e43efc4ea",
  ic10: "50017adb0782266b8279365767d5c4a55c1c7106a6fe7e79f0bf46ab69a2713d",
  ic11: "016f25eabacaa26440f9a6edda946fe7382c277113cf4b218a819810de420970",
  ic12: "851d4531ab5350c3721099e2130cc952c590e91d4f2872515349251e05e41dd9",
  ic13: "3ac2359a170e8587af35b7570a80671991c2a62983ec48eec9497de0805685ff",
  ic14: "990d6282d5fb4ad596f773899c8e948f4dba0d8de793c2c26857488e43efc4ea",
} as const;

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const LINUX_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512] as const;
const SYSTEM_ICONSET_FILES = [
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
] as const;
const SYSTEM_FRAME_SOURCES = new Map([
  ["icon_16x16@2x.png", "ic11"],
  ["icon_32x32@2x.png", "ic12"],
  ["icon_128x128.png", "ic07"],
  ["icon_128x128@2x.png", "ic13"],
  ["icon_256x256.png", "ic08"],
  ["icon_256x256@2x.png", "ic14"],
  ["icon_512x512.png", "ic09"],
  ["icon_512x512@2x.png", "ic10"],
]);
const LEGACY_SYSTEM_FRAME_PIXEL_HASHES = new Map([
  [
    "icon_16x16.png",
    "50837fdbb25aae3faa2c4cb86f5916355d5e7d3736d6612ed255e2617c8a431d",
  ],
  [
    "icon_32x32.png",
    "124257211d7b06681343a29866c871342d9b5970eeaefa2355129602fad75560",
  ],
]);

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

function decodeRgbaPng(data: Buffer): {
  width: number;
  height: number;
  pixels: Buffer;
} {
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (
    data.readUInt8(24) !== 8 ||
    data.readUInt8(25) !== 6 ||
    data.readUInt8(26) !== 0 ||
    data.readUInt8(27) !== 0 ||
    data.readUInt8(28) !== 0
  ) {
    throw new Error(
      `Expected a non-interlaced 8-bit RGBA PNG, got ${width}x${height}`
    );
  }

  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      idatChunks.push(data.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idatChunks));
  if (raw.length !== (rowLength + 1) * height) {
    throw new Error(`Unexpected PNG scanline length for ${width}x${height}`);
  }

  const pixels = Buffer.allocUnsafe(rowLength * height);
  const rawBytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const pixelBytes = new Uint8Array(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength
  );
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = rawBytes[rawOffset] ?? 0;
    rawOffset += 1;
    const rowOffset = y * rowLength;
    const previousRowOffset = rowOffset - rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const source = rawBytes[rawOffset + x] ?? 0;
      const left =
        x >= bytesPerPixel
          ? (pixelBytes[rowOffset + x - bytesPerPixel] ?? 0)
          : 0;
      const above = y > 0 ? (pixelBytes[previousRowOffset + x] ?? 0) : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? (pixelBytes[previousRowOffset + x - bytesPerPixel] ?? 0)
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
      pixelBytes[rowOffset + x] = value % 256;
    }
    rawOffset += rowLength;
  }
  return { width, height, pixels };
}

const DECODED_PIXEL_HASHES = new Map<string, string>();

function decodedPixelHash(data: Buffer): string {
  const encodedHash = sha256Bytes(data);
  const cached = DECODED_PIXEL_HASHES.get(encodedHash);
  if (cached) {
    return cached;
  }
  const pixelHash = sha256Bytes(decodeRgbaPng(data).pixels);
  DECODED_PIXEL_HASHES.set(encodedHash, pixelHash);
  return pixelHash;
}

function cornerAlphas(width: number, height: number, pixels: Buffer): number[] {
  const alphaAt = (x: number, y: number) =>
    pixels.readUInt8((y * width + x) * 4 + 3);
  return [
    alphaAt(0, 0),
    alphaAt(width - 1, 0),
    alphaAt(0, height - 1),
    alphaAt(width - 1, height - 1),
  ];
}

function parseIco(data: Buffer): Array<{ size: number; png: Buffer }> {
  if (data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error("Invalid ICO header");
  }
  const count = data.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const width = data.readUInt8(offset) || 256;
    const height = data.readUInt8(offset + 1) || 256;
    if (width !== height) {
      throw new Error(`Non-square ICO frame ${width}x${height}`);
    }
    const length = data.readUInt32LE(offset + 8);
    const payloadOffset = data.readUInt32LE(offset + 12);
    return {
      size: width,
      png: Buffer.from(data.subarray(payloadOffset, payloadOffset + length)),
    };
  });
}

describe("Pier application icon sources", () => {
  it("keeps the design archive on the approved F and I system only", () => {
    const archive = read("build/design-sources/index.html");
    const imageSources = Array.from(
      archive.matchAll(/<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')/gi),
      (match) => match[1] ?? match[2]
    );

    for (const obsolete of [
      "build/design-sources/pier-pier.svg",
      "build/design-sources/pier-panels.svg",
      "build/design-sources/pier-berth.svg",
      "build/design-sources/pier-berth-macos.svg",
    ]) {
      expect(existsSync(join(ROOT, obsolete))).toBe(false);
    }

    expect(Array.from(new Set(imageSources)).sort()).toEqual([
      "../app-icon-master.svg",
      "../app-icon-micro.svg",
      "./pier-logo.svg",
    ]);
    expect(archive).toContain("#b66cff");
    expect(archive).toContain("#8549ff");
    expect(archive).toContain("#542ee5");
    expect(archive).not.toMatch(/<\s*(?:svg|path|symbol|script)\b/i);
    expect(archive).not.toMatch(/三个停靠的方向|Direction [ABC]|ico-[abc]/i);
    expect(archive).not.toMatch(
      /pier-pier\.svg|pier-panels\.svg|pier-berth(?:-macos)?\.svg/
    );
  });

  it("locks the approved F and I renditions and transparent F mark byte-for-byte", () => {
    expect(sha256(read("build/app-icon-master.svg"))).toBe(
      "114aa8365ad861862679628de4deca14795439f150b44c6d69588c45e58aebef"
    );
    expect(sha256(read("build/app-icon-micro.svg"))).toBe(
      "adb75880368522de184ba1d74cfafe2538c223e55932041efdfba1290e26c28e"
    );
    expect(sha256(read("build/design-sources/pier-logo.svg"))).toBe(
      "a8cb88be38a0ea465e5796d2c69042be046c9d850234eea933c9507c020ead52"
    );
  });

  it("keeps the approved Micro optical corrections", () => {
    const micro = read("build/app-icon-micro.svg");

    expect(micro).toMatch(/id="screen-left-top-glow"[^>]*opacity="0"/);
    expect(micro).toMatch(/id="terminal-material-effects"[^>]*opacity="0"/);
    expect(micro).toContain('stroke-width="6.6"');
    expect(micro).toContain('stroke-width="7"');
    expect(micro).toContain("2.4 15-17.6 27-40 27");
  });

  it("renders the Dock artwork at the approved optical footprint", () => {
    const { width, height, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels.readUInt8((y * width + x) * 4 + 3) === 0) {
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const artworkWidth = maxX - minX + 1;
    const artworkHeight = maxY - minY + 1;
    expect(artworkWidth).toBeGreaterThanOrEqual(436);
    expect(artworkWidth).toBeLessThanOrEqual(440);
    expect(artworkHeight).toBeGreaterThanOrEqual(436);
    expect(artworkHeight).toBeLessThanOrEqual(440);
    expect(Math.abs(minX - (width - 1 - maxX))).toBeLessThanOrEqual(1);
    expect(Math.abs(minY - (height - 1 - maxY))).toBeLessThanOrEqual(1);
  });

  it("keeps the rendered mark vertically balanced inside the plate", () => {
    const { width, height, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    let plateMinY = height;
    let plateMaxY = -1;
    let markMinY = height;
    let markMaxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const red = pixels.readUInt8(offset);
        const green = pixels.readUInt8(offset + 1);
        const blue = pixels.readUInt8(offset + 2);
        const alpha = pixels.readUInt8(offset + 3);
        if (alpha === 0) {
          continue;
        }
        plateMinY = Math.min(plateMinY, y);
        plateMaxY = Math.max(plateMaxY, y);

        const isColoredMark =
          blue > 85 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) > 35;
        const isLightGlyph = Math.min(red, green, blue) > 145;
        if (alpha > 200 && (isColoredMark || isLightGlyph)) {
          markMinY = Math.min(markMinY, y);
          markMaxY = Math.max(markMaxY, y);
        }
      }
    }

    const topGap = markMinY - plateMinY;
    const bottomGap = plateMaxY - markMaxY;
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(3);
  });

  it("keeps upper plate lighting neutral from left to right", () => {
    const { width, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    const rgbAt = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return [
        pixels.readUInt8(offset),
        pixels.readUInt8(offset + 1),
        pixels.readUInt8(offset + 2),
      ];
    };
    const upperLeft = rgbAt(160, 80);
    const upperRight = rgbAt(352, 80);

    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs(upperLeft[channel] - upperRight[channel])
      ).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the plate surface flat from top to bottom", () => {
    const { width, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    const rgbAt = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return [
        pixels.readUInt8(offset),
        pixels.readUInt8(offset + 1),
        pixels.readUInt8(offset + 2),
      ];
    };
    const upperPlate = rgbAt(256, 80);
    const lowerPlate = rgbAt(256, 420);

    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs(upperPlate[channel] - lowerPlate[channel])
      ).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the plate outline uniform on every edge", () => {
    const { width, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    const rgbAt = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return [
        pixels.readUInt8(offset),
        pixels.readUInt8(offset + 1),
        pixels.readUInt8(offset + 2),
      ];
    };
    const edges = [
      rgbAt(256, 41),
      rgbAt(470, 256),
      rgbAt(256, 470),
      rgbAt(41, 256),
    ];

    for (let index = 1; index < edges.length; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(
          Math.abs(edges[0][channel] - edges[index][channel])
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("keeps the rendered U mark at one optical stroke weight", () => {
    const { width, height, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    expect([width, height]).toEqual([512, 512]);

    const isBrandPurple = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      const green = pixels.readUInt8(offset + 1);
      const blue = pixels.readUInt8(offset + 2);
      const alpha = pixels.readUInt8(offset + 3);
      return alpha > 200 && blue >= 100 && blue - green >= 50;
    };
    const longestRun = (values: boolean[]) => {
      let longest = 0;
      let current = 0;
      for (const value of values) {
        current = value ? current + 1 : 0;
        longest = Math.max(longest, current);
      }
      return longest;
    };

    const leftStroke = longestRun(
      Array.from({ length: 90 }, (_, index) => isBrandPurple(70 + index, 268))
    );
    const rightStroke = longestRun(
      Array.from({ length: 90 }, (_, index) => isBrandPurple(360 + index, 268))
    );
    const bottomStroke = longestRun(
      Array.from({ length: 120 }, (_, index) => isBrandPurple(256, 300 + index))
    );
    const sideStroke = (leftStroke + rightStroke) / 2;

    expect(Math.abs(leftStroke - rightStroke)).toBeLessThanOrEqual(2);
    expect(Math.abs(bottomStroke - sideStroke)).toBeLessThanOrEqual(6);
  });

  it("keeps the rendered U mark material highlight above its body", () => {
    const { width, pixels } = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icon.png"))
    );
    const lightnessAt = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return (
        pixels.readUInt8(offset) +
        pixels.readUInt8(offset + 1) +
        pixels.readUInt8(offset + 2)
      );
    };

    const shelfHighlight = lightnessAt(256, 352);
    const lowerBody = lightnessAt(256, 367);

    expect(shelfHighlight - lowerBody).toBeGreaterThanOrEqual(120);
  });

  it("keeps transparent F exports free of the macOS plate", () => {
    const mark = read("build/design-sources/pier-logo.svg");
    const unplated = read("build/app-icon-unplated.svg");

    expect(mark).toContain('viewBox="0 0 210 170"');
    expect(mark).toContain(
      'id="berth-layer" transform="translate(104.5 145) scale(0.9) translate(-104.5 -145)"'
    );
    expect(mark).not.toContain("app-plate-fill");
    expect(unplated).not.toContain("app-plate-fill");
  });

  it("ships vector-only sources", () => {
    for (const path of [
      "build/app-icon-master.svg",
      "build/app-icon-micro.svg",
      "build/design-sources/pier-logo.svg",
      "build/app-icon-unplated.svg",
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/<image(?:\s|>)/i);
      expect(source).not.toMatch(/<text(?:\s|>)/i);
      expect(source).not.toMatch(/(?:base64|data:|\shref=)/i);
    }
  });

  it("ships Micro ICNS frames through 128px and Standard frames above it", () => {
    const icns = readFileSync(join(ROOT, "build/icon.icns"));
    const actual = Object.fromEntries(
      parseIcns(icns)
        .filter((entry) => entry.type in EXPECTED_ICNS_FRAME_HASHES)
        .map((entry) => [entry.type, sha256Bytes(entry.data)])
    );

    expect(actual).toEqual(EXPECTED_ICNS_FRAME_HASHES);
  });

  it.runIf(process.platform === "darwin")(
    "round-trips every official macOS frame through iconutil without pixel corruption",
    { timeout: 15_000 },
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-system-iconset-"));
      const output = join(root, "Pier.iconset");
      try {
        execFileSync("iconutil", [
          "--convert",
          "iconset",
          "--output",
          output,
          join(ROOT, "build/icon.icns"),
        ]);
        expect(readdirSync(output).sort()).toEqual(
          [...SYSTEM_ICONSET_FILES].sort()
        );

        const sourceEntries = new Map(
          parseIcns(readFileSync(join(ROOT, "build/icon.icns"))).map(
            (entry) => [entry.type, entry.data]
          )
        );
        for (const file of SYSTEM_ICONSET_FILES) {
          const decoded = readFileSync(join(output, file));
          const legacyHash = LEGACY_SYSTEM_FRAME_PIXEL_HASHES.get(file);
          if (legacyHash) {
            expect(decodedPixelHash(decoded)).toBe(legacyHash);
            continue;
          }
          const sourceType = SYSTEM_FRAME_SOURCES.get(file);
          const source = sourceType ? sourceEntries.get(sourceType) : undefined;
          expect(source, `Missing ICNS source for ${file}`).toBeDefined();
          expect(decodedPixelHash(decoded)).toBe(
            decodedPixelHash(source as Buffer)
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it("uses the approved Micro rendition for the development Dock", () => {
    const dockIcon = readFileSync(join(ROOT, "build/icon.png"));

    expect(sha256Bytes(dockIcon)).toBe(
      "0cb6b2d8f8e071d8f522827625d7e8ae09f5f0dfda5e30f62526941a127704f4"
    );
  });

  it("ships transparent RGBA Linux icons at the complete official size set", () => {
    for (const size of LINUX_SIZES) {
      const png = readFileSync(join(ROOT, `build/icons/${size}x${size}.png`));
      const decoded = decodeRgbaPng(png);
      expect([decoded.width, decoded.height]).toEqual([size, size]);
      expect(
        cornerAlphas(decoded.width, decoded.height, decoded.pixels)
      ).toEqual([0, 0, 0, 0]);
    }
  });

  it("ships transparent Windows frames matching the Linux F rendition pixels", () => {
    const frames = parseIco(readFileSync(join(ROOT, "build/icon.ico")));
    expect(frames.map((frame) => frame.size)).toEqual(ICO_SIZES);

    for (const frame of frames) {
      const linux = readFileSync(
        join(ROOT, `build/icons/${frame.size}x${frame.size}.png`)
      );
      expect(frame.png).toEqual(linux);
      const decoded = decodeRgbaPng(frame.png);
      expect(
        cornerAlphas(decoded.width, decoded.height, decoded.pixels)
      ).toEqual([0, 0, 0, 0]);
    }
  });

  it("wires the generated icon assets into packaging, development, docs, and CI", () => {
    const builder = read("electron-builder.yml");
    expect(builder).toMatch(/mac:[\s\S]*?icon: build\/icon\.icns/);
    expect(builder).toMatch(/win:[\s\S]*?icon: build\/icon\.ico/);
    expect(builder).toMatch(/linux:[\s\S]*?icon: build\/icons/);

    expect(read("src/main/index.ts")).toContain('"../../build/icon.png"');
    expect(read("src/main/windows/factory.ts")).toContain(
      '"../../build/icon.png"'
    );

    const development = read("docs/development.md");
    expect(development).toContain("pnpm build:icons");
    expect(development).toContain("build/app-icon-master.svg");
    expect(development).toContain("build/app-icon-micro.svg");
    expect(development).toContain("brew install librsvg");

    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("'build/app-icon-*.svg'");
    expect(ci).toContain("'build/design-sources/pier-logo.svg'");
    expect(ci).toContain("'build/icon.*'");
    expect(ci).toContain("'build/icons/**'");
    expect(ci).toContain("mac_icons:");
    expect(ci).toContain("runs-on: macos-15");
    expect(ci).toContain("tests/unit/scripts/app-icon-assets.test.ts");
  });
});
