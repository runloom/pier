import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeIcns, parseIcns } from "../../../scripts/app-icon-icns.mjs";

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
  icp4: "d19bd4e91c1cad0ebd05f7ff3356867e6de55230eaed236aa43c0774974410d9",
  icp5: "c4f670863fa086b9dfc923153bb520348131f7829b97e0c7b90e913157cd33b7",
  icp6: "77c563f7ac8239944a993cc05879ec633a1b8811a6153d1c100e4ba37a239144",
  ic07: "b7523263ddab5bcbd4085fcf28ed321ae0f160e876c7cd2e5fdc57916cb636c3",
  ic08: "78393d531bec6c8fe661a56d6ad51102e7274b344bf341a511e11a5056aec61c",
  ic09: "d29a33f99def9b356042dae73ec0820b1728e20173fc8ca3fc7240e966a27cdb",
  ic10: "a9ae3dda2f0f6be5a9407a9814ffccd8170252d6caa3ad44be7e3b5eca668f8e",
  ic11: "c4f670863fa086b9dfc923153bb520348131f7829b97e0c7b90e913157cd33b7",
  ic12: "77c563f7ac8239944a993cc05879ec633a1b8811a6153d1c100e4ba37a239144",
  ic13: "78393d531bec6c8fe661a56d6ad51102e7274b344bf341a511e11a5056aec61c",
  ic14: "d29a33f99def9b356042dae73ec0820b1728e20173fc8ca3fc7240e966a27cdb",
} as const;

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const LINUX_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512] as const;

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
  parseIcns(encodeIcns([{ type: "test", data }]));

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

  const pixels = Buffer.alloc(rowLength * height);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(rawOffset);
    rawOffset += 1;
    const rowOffset = y * rowLength;
    const previousRowOffset = rowOffset - rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const source = raw.readUInt8(rawOffset + x);
      const left =
        x >= bytesPerPixel
          ? pixels.readUInt8(rowOffset + x - bytesPerPixel)
          : 0;
      const above = y > 0 ? pixels.readUInt8(previousRowOffset + x) : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels.readUInt8(previousRowOffset + x - bytesPerPixel)
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
  return { width, height, pixels };
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
  it("locks the approved F and I renditions byte-for-byte", () => {
    expect(sha256(read("build/app-icon-master.svg"))).toBe(
      "ed1f59e2d4f95f62ed4a3336999f83e72003f31449a842b70f2d21b6e7ce8f2d"
    );
    expect(sha256(read("build/app-icon-micro.svg"))).toBe(
      "8e3387d34d9eef1861d3e1768798ca09be1d07c087aed2ea2426afe95eb17ae3"
    );
  });

  it("keeps the approved Micro optical corrections", () => {
    const micro = read("build/app-icon-micro.svg");

    expect(micro).toMatch(/id="screen-left-top-glow"[^>]*opacity="0"/);
    expect(micro).toMatch(/id="terminal-material-effects"[^>]*opacity="0"/);
    expect(micro).toContain('stroke-width="6.6"');
    expect(micro).toContain('stroke-width="7"');
    expect(micro).toContain("2.4 19-17.6 35-40 35");
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
      parseIcns(icns).map((entry) => [entry.type, sha256Bytes(entry.data)])
    );

    expect(actual).toEqual(EXPECTED_ICNS_FRAME_HASHES);
  });

  it("uses the approved Micro rendition for the development Dock", () => {
    const dockIcon = readFileSync(join(ROOT, "build/icon.png"));

    expect(sha256Bytes(dockIcon)).toBe(
      "26742aaa53f47aa8dbc8a33c7e77caba6220a5895cfd39ff8913267fe634ef32"
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
  });
});
