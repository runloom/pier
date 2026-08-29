import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const;

interface DecodedPng {
  height: number;
  pixels: Buffer;
  width: number;
}

type RasterPoint = [number, number];

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

function rgbaAt(
  image: DecodedPng,
  x: number,
  y: number
): [number, number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    image.pixels.readUInt8(offset),
    image.pixels.readUInt8(offset + 1),
    image.pixels.readUInt8(offset + 2),
    image.pixels.readUInt8(offset + 3),
  ];
}

function relativeLuminance([red, green, blue]: [
  number,
  number,
  number,
  number,
]): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function fourConnectedComponents(points: Set<string>): RasterPoint[][] {
  const components: RasterPoint[][] = [];
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  while (points.size > 0) {
    const first = points.values().next().value as string;
    points.delete(first);
    const separator = first.indexOf(",");
    const queue: RasterPoint[] = [
      [Number(first.slice(0, separator)), Number(first.slice(separator + 1))],
    ];
    const component: RasterPoint[] = [];
    while (queue.length > 0) {
      const point = queue.pop() as RasterPoint;
      component.push(point);
      for (const [offsetX, offsetY] of neighbors) {
        const neighbor: RasterPoint = [point[0] + offsetX, point[1] + offsetY];
        if (points.delete(`${neighbor[0]},${neighbor[1]}`)) {
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components
    .filter((component) => component.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function componentBounds(component: RasterPoint[]) {
  const xs = component.map(([x]) => x);
  const ys = component.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    height: maxY - minY + 1,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX + 1,
  };
}

function brightPromptComponents(image: DecodedPng): RasterPoint[][] {
  const points = new Set<string>();
  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [red, green, blue, alpha] = rgbaAt(image, x, y);
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum > 0 ? (maximum - minimum) / maximum : 0;
      if (
        alpha > 0 &&
        maximum >= 102 &&
        (saturation >= 0.35 || maximum >= 120)
      ) {
        points.add(`${x},${y}`);
      }
    }
  }
  return fourConnectedComponents(points);
}

function violetBerthComponents(image: DecodedPng): RasterPoint[][] {
  const points = new Set<string>();
  for (let y = Math.floor(image.height * 0.56); y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [red, green, blue, alpha] = rgbaAt(image, x, y);
      const maximum = Math.max(red, green, blue);
      if (alpha > 0 && blue > red && red > green + 6 && maximum >= 80) {
        points.add(`${x},${y}`);
      }
    }
  }
  return fourConnectedComponents(points);
}

function maximumHorizontalRun(component: RasterPoint[], y: number): number {
  const xs = component
    .filter(([, pointY]) => pointY === y)
    .map(([x]) => x)
    .sort((left, right) => left - right);
  let maximum = 0;
  let current = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const x of xs) {
    current = x === previous + 1 ? current + 1 : 1;
    maximum = Math.max(maximum, current);
    previous = x;
  }
  return maximum;
}

describe("Pier generated small app icons", () => {
  it("ships only the pinned app-builder size set", () => {
    expect(readdirSync(join(ROOT, "build/icons")).sort()).toEqual(
      ICON_SIZES.map((size) => `${size}x${size}.png`).sort()
    );
  });

  it.each(ICON_SIZES)("ships a valid full-bleed %ipx PNG", (size) => {
    const image = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icons", `${size}x${size}.png`))
    );
    expect([image.width, image.height]).toEqual([size, size]);
    expect(rgbaAt(image, 0, 0)[3]).toBeGreaterThanOrEqual(250);
    expect(rgbaAt(image, size - 1, size - 1)[3]).toBeGreaterThanOrEqual(250);
  });

  it("keeps the 16px terminal prompt as two readable bright components", () => {
    const image = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icons/16x16.png"))
    );
    const components = brightPromptComponents(image);
    expect(components.length).toBeGreaterThanOrEqual(1);
    const chevronComponent = components[0];
    if (!chevronComponent) {
      throw new Error("The 16px prompt must keep the chevron");
    }
    const chevron = componentBounds(chevronComponent);
    expect(chevron.width).toBeGreaterThanOrEqual(2);
    expect(chevron.height).toBeGreaterThanOrEqual(3);
    const underscoreComponent = components[1];
    if (underscoreComponent) {
      const underscore = componentBounds(underscoreComponent);
      expect(underscore.width).toBeGreaterThanOrEqual(1);
      expect(underscore.height).toBeGreaterThanOrEqual(1);
      expect(underscore.height).toBeLessThanOrEqual(3);
    }
  });

  it("keeps a continuous violet berth at 16px", () => {
    const image = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icons/16x16.png"))
    );
    const berth = violetBerthComponents(image)[0];
    expect(berth).toBeDefined();
    if (!berth) {
      throw new Error("The 16px icon must keep its violet berth");
    }
    const bounds = componentBounds(berth);
    expect(bounds.width).toBeGreaterThanOrEqual(12);
    expect(bounds.height).toBeGreaterThanOrEqual(4);
    expect(bounds.maxY).toBeGreaterThanOrEqual(13);
    const strongRows = Array.from(
      { length: bounds.height },
      (_, index) => bounds.minY + index
    ).filter((y) => maximumHorizontalRun(berth, y) >= 8);
    expect(strongRows.length).toBeGreaterThanOrEqual(2);
    expect(strongRows.some((y, index) => strongRows[index + 1] === y + 1)).toBe(
      true
    );
  });

  it("does not render the berth closing edge as a dark bottom seam", () => {
    const image = decodeRgbaPng(
      readFileSync(join(ROOT, "build/icons/512x512.png"))
    );
    const centerX = Math.floor(image.width / 2);
    const opaqueRows = Array.from({ length: image.height }, (_, y) => y).filter(
      (y) => rgbaAt(image, centerX, y)[3] >= 250
    );
    const lastOpaqueY = opaqueRows.at(-1);
    expect(lastOpaqueY).toBeDefined();
    if (lastOpaqueY === undefined) {
      throw new Error("The berth must have an opaque center-bottom edge");
    }

    const edgeLuminance = relativeLuminance(
      rgbaAt(image, centerX, lastOpaqueY)
    );
    const interiorLuminance = relativeLuminance(
      rgbaAt(image, centerX, lastOpaqueY - 4)
    );
    expect(edgeLuminance / interiorLuminance).toBeGreaterThanOrEqual(0.86);
  });
});
