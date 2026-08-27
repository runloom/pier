import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "pier-small-icon-output-"));

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
  expect([
    data.readUInt8(24),
    data.readUInt8(25),
    data.readUInt8(26),
    data.readUInt8(27),
    data.readUInt8(28),
  ]).toEqual([8, 6, 0, 0, 0]);

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
  return decodeRgbaPng(readFileSync(output));
}

function rgbaAt(
  { pixels, width }: DecodedPng,
  x: number,
  y: number
): [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    pixels.readUInt8(offset),
    pixels.readUInt8(offset + 1),
    pixels.readUInt8(offset + 2),
    pixels.readUInt8(offset + 3),
  ];
}

function brandPixel(pixel: [number, number, number, number]): boolean {
  const [red, green, blue, alpha] = pixel;
  return (
    alpha >= 64 &&
    Math.max(red, green, blue) >= 70 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) >= 28
  );
}

interface Component {
  area: number;
  height: number;
  width: number;
}

function connectedComponents(
  decoded: DecodedPng,
  include: (pixel: [number, number, number, number], y: number) => boolean
): Component[] {
  const { height, width } = decoded;
  const active = new Set<number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (include(rgbaAt(decoded, x, y), y)) {
        active.add(y * width + x);
      }
    }
  }

  const components: Component[] = [];
  while (active.size > 0) {
    const first = active.values().next().value as number;
    active.delete(first);
    const queue = [first];
    let area = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    while (queue.length > 0) {
      const index = queue.pop() as number;
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          const neighbor = neighborY * width + neighborX;
          if (
            neighborX >= 0 &&
            neighborX < width &&
            neighborY >= 0 &&
            neighborY < height &&
            active.has(neighbor)
          ) {
            active.delete(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
    if (area >= 2) {
      components.push({
        area,
        height: maxY - minY + 1,
        width: maxX - minX + 1,
      });
    }
  }
  return components.sort((a, b) => b.area - a.area);
}

function promptComponents(decoded: DecodedPng): Component[] {
  const limitY = Math.floor(decoded.height * 0.61);
  return connectedComponents(
    decoded,
    (pixel, y) => y < limitY && brandPixel(pixel)
  );
}

function highChromaComponents(decoded: DecodedPng): Component[] {
  const limitY = Math.ceil(decoded.height * 0.63);
  return connectedComponents(decoded, ([red, green, blue, alpha], y) => {
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    return (
      y < limitY && alpha >= 192 && maximum >= 100 && maximum - minimum >= 50
    );
  });
}

const ROUTING = new Map([
  [16, "build/app-icon-16.svg"],
  [24, "build/app-icon-tiny.svg"],
  [32, "build/app-icon-tiny.svg"],
  [48, "build/app-icon-tiny.svg"],
  [64, "build/app-icon-small.svg"],
  [96, "build/app-icon-small.svg"],
  [128, "build/app-icon-small.svg"],
  [256, "build/app-icon-master.svg"],
  [512, "build/app-icon-master.svg"],
]);

describe("Pier small app-icon output", () => {
  it.runIf(hasRsvgConvert)(
    "routes every Linux size to its independent optical rendition",
    () => {
      for (const [size, source] of ROUTING) {
        const actual = decodeRgbaPng(
          readFileSync(join(ROOT, `build/icons/${size}x${size}.png`))
        );
        const expected = rasterized(source, size);
        expect([actual.width, actual.height], `${size}px dimensions`).toEqual([
          size,
          size,
        ]);
        expect(actual.pixels, `${size}px decoded pixels`).toEqual(
          expected.pixels
        );
      }
    }
  );

  it.each([
    {
      arrow: { area: 8, height: 5, width: 3 },
      size: 16,
      underscore: { area: 3, height: 1, width: 3 },
    },
    {
      arrow: { area: 28, height: 11, width: 7 },
      size: 32,
      underscore: { area: 12, height: 2, width: 7 },
    },
  ])("keeps the terminal prompt separated and readable at $size px", ({
    arrow,
    size,
    underscore,
  }) => {
    const decoded = decodeRgbaPng(
      readFileSync(join(ROOT, `build/icons/${size}x${size}.png`))
    );
    const components = promptComponents(decoded);
    const arrowComponent = components.find(
      (component) =>
        component.area >= arrow.area &&
        component.height >= arrow.height &&
        component.width >= arrow.width
    );
    const underscoreComponent = components.find(
      (component) =>
        component !== arrowComponent &&
        component.area >= underscore.area &&
        component.height >= underscore.height &&
        component.width >= underscore.width
    );
    expect(
      arrowComponent,
      `${size}px > glyph; components=${JSON.stringify(components)}`
    ).toBeDefined();
    expect(
      underscoreComponent,
      `${size}px _ glyph; components=${JSON.stringify(components)}`
    ).toBeDefined();
  });

  it("keeps >, _, and both berth shoulders optically separate at 16px", () => {
    const decoded = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icons/16x16.png"))
    );
    const components = highChromaComponents(decoded);
    expect(
      components,
      `16px high-chroma components=${JSON.stringify(components)}`
    ).toHaveLength(4);
    expect(components.at(-1)?.area).toBeGreaterThanOrEqual(2);
  });

  it.each([
    16, 32,
  ])("keeps the berth continuous and nearly full-width at %i px", (size) => {
    const decoded = decodeRgbaPng(
      readFileSync(join(ROOT, `build/icons/${size}x${size}.png`))
    );
    const columns = new Set<number>();
    for (let y = Math.floor(size * 0.58); y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (brandPixel(rgbaAt(decoded, x, y))) {
          columns.add(x);
        }
      }
    }
    const minX = Math.min(...columns);
    const maxX = Math.max(...columns);
    expect(maxX - minX + 1).toBeGreaterThanOrEqual(size === 16 ? 15 : 29);
    for (let x = minX; x <= maxX; x += 1) {
      expect(columns.has(x), `visible berth column ${x} at ${size}px`).toBe(
        true
      );
    }
  });

  it("keeps the 16px silhouette crisp without opaque border clipping", () => {
    const decoded = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icons/16x16.png"))
    );
    const borderAlphas: number[] = [];
    let minSolidX = decoded.width;
    let maxSolidX = -1;
    let minSolidY = decoded.height;
    let maxSolidY = -1;
    for (let y = 0; y < decoded.height; y += 1) {
      for (let x = 0; x < decoded.width; x += 1) {
        const [red, green, blue, alpha] = rgbaAt(decoded, x, y);
        if (alpha === 0) {
          expect([red, green, blue]).toEqual([0, 0, 0]);
        }
        if (
          x === 0 ||
          y === 0 ||
          x === decoded.width - 1 ||
          y === decoded.height - 1
        ) {
          borderAlphas.push(alpha);
        }
        if (alpha >= 192) {
          minSolidX = Math.min(minSolidX, x);
          maxSolidX = Math.max(maxSolidX, x);
          minSolidY = Math.min(minSolidY, y);
          maxSolidY = Math.max(maxSolidY, y);
        }
      }
    }
    expect(Math.max(...borderAlphas)).toBeLessThanOrEqual(146);
    expect([maxSolidX - minSolidX + 1, maxSolidY - minSolidY + 1]).toEqual([
      14, 14,
    ]);
    for (const [x, y] of [
      [0, 0],
      [15, 0],
      [0, 15],
      [15, 15],
    ]) {
      expect(rgbaAt(decoded, x, y)[3]).toBe(0);
    }
  });
});
