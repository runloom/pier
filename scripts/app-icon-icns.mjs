import { Buffer } from "node:buffer";
import { crc32, inflateSync } from "node:zlib";

const ICNS_HEADER_SIZE = 8;
const ICNS_ENTRY_HEADER_SIZE = 8;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const ICNS_DIMENSIONS = Object.freeze({
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
});

const STANDARD_ICNS_SOURCE_TYPES = Object.freeze({
  ic08: "ic08",
  ic09: "ic09",
  ic10: "ic10",
  ic13: "ic08",
  ic14: "ic09",
});
const LEGACY_ICNS_TYPES = Object.freeze(["is32", "s8mk", "il32", "l8mk"]);
const LEGACY_ALPHA_DIMENSIONS = Object.freeze({
  s8mk: 16,
  l8mk: 32,
});
const LEGACY_RGB_DIMENSIONS = Object.freeze({
  is32: 16,
  il32: 32,
});
const PNG_ICNS_TYPES = new Set([
  "icp4",
  "icp5",
  "icp6",
  ...Object.keys(ICNS_DIMENSIONS),
]);
const ICNS_METADATA_TYPES = new Set(["TOC ", "info"]);

function assertPng(type, data) {
  if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`ICNS entry ${type} does not contain a PNG`);
  }

  let width;
  let height;
  let sawIhdr = false;
  let sawIend = false;
  const idatChunks = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < data.length) {
    if (data.length - offset < 12) {
      throw new Error(`ICNS entry ${type} has a truncated PNG chunk header`);
    }

    const length = data.readUInt32BE(offset);
    const chunkType = data.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > data.length) {
      throw new Error(
        `ICNS entry ${type} has a truncated PNG ${chunkType} chunk`
      );
    }

    const expectedCrc = data.readUInt32BE(dataEnd);
    const actualCrc = crc32(data.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new Error(`ICNS entry ${type} PNG ${chunkType} CRC is invalid`);
    }

    if (!sawIhdr && chunkType !== "IHDR") {
      throw new Error(`ICNS entry ${type} PNG does not begin with IHDR`);
    }

    if (chunkType === "IHDR") {
      if (sawIhdr || length !== 13) {
        throw new Error(`ICNS entry ${type} has an invalid PNG IHDR`);
      }
      width = data.readUInt32BE(dataStart);
      height = data.readUInt32BE(dataStart + 4);
      const bitDepth = data[dataStart + 8];
      const colorType = data[dataStart + 9];
      const compression = data[dataStart + 10];
      const filter = data[dataStart + 11];
      const interlace = data[dataStart + 12];
      if (
        width === 0 ||
        height === 0 ||
        bitDepth !== 8 ||
        colorType !== 6 ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        throw new Error(
          `ICNS entry ${type} must be a non-interlaced 8-bit RGBA PNG`
        );
      }
      sawIhdr = true;
    } else if (chunkType === "IDAT") {
      if (!sawIhdr || sawIend) {
        throw new Error(`ICNS entry ${type} has a misplaced PNG IDAT`);
      }
      idatChunks.push(data.subarray(dataStart, dataEnd));
    } else if (chunkType === "IEND") {
      if (length !== 0 || !sawIhdr || idatChunks.length === 0) {
        throw new Error(`ICNS entry ${type} has an invalid PNG IEND`);
      }
      if (chunkEnd !== data.length) {
        throw new Error(`ICNS entry ${type} has data after PNG IEND`);
      }
      sawIend = true;
    }

    offset = chunkEnd;
  }

  if (!sawIhdr) {
    throw new Error(`ICNS entry ${type} has no PNG IHDR`);
  }
  if (!sawIend) {
    throw new Error(`ICNS entry ${type} has no PNG IEND`);
  }
  let scanlines;
  try {
    scanlines = inflateSync(Buffer.concat(idatChunks));
  } catch (error) {
    throw new Error(`ICNS entry ${type} has invalid PNG image data`, {
      cause: error,
    });
  }
  const rowLength = width * 4 + 1;
  const expectedScanlineLength = rowLength * height;
  if (
    !Number.isSafeInteger(expectedScanlineLength) ||
    scanlines.length !== expectedScanlineLength
  ) {
    throw new Error(
      `ICNS entry ${type} PNG scanline length ${scanlines.length} does not match ${expectedScanlineLength}`
    );
  }
  for (let row = 0; row < height; row += 1) {
    const filterType = scanlines.readUInt8(row * rowLength);
    if (filterType > 4) {
      throw new Error(
        `ICNS entry ${type} PNG row ${row} has invalid filter ${filterType}`
      );
    }
  }
  if (width !== height) {
    throw new Error(`ICNS entry ${type} PNG is not square: ${width}x${height}`);
  }
  return width;
}

function assertEntryData(type, data) {
  if (PNG_ICNS_TYPES.has(type)) {
    assertPng(type, data);
    return;
  }
  const rgbDimension = LEGACY_RGB_DIMENSIONS[type];
  if (rgbDimension !== undefined) {
    assertLegacyRgb(type, data, rgbDimension);
    return;
  }
  const alphaDimension = LEGACY_ALPHA_DIMENSIONS[type];
  if (alphaDimension !== undefined) {
    const expectedLength = alphaDimension * alphaDimension;
    if (data.length !== expectedLength) {
      throw new Error(
        `ICNS legacy alpha entry ${type} has ${data.length} bytes; expected ${expectedLength}`
      );
    }
    return;
  }
  if (ICNS_METADATA_TYPES.has(type)) {
    return;
  }
  throw new Error(`Unsupported ICNS entry type ${type}`);
}

function assertLegacyRgb(type, data, dimension) {
  const pixelsPerChannel = dimension * dimension;
  let offset = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    let decoded = 0;
    while (decoded < pixelsPerChannel) {
      if (offset >= data.length) {
        throw new Error(
          `ICNS legacy RGB entry ${type} is truncated in channel ${channel}`
        );
      }
      const control = data[offset];
      offset += 1;
      const isLiteral = control < 128;
      const count = isLiteral ? control + 1 : control - 125;
      const encodedLength = isLiteral ? count : 1;
      if (offset + encodedLength > data.length) {
        throw new Error(
          `ICNS legacy RGB entry ${type} is truncated in channel ${channel}`
        );
      }
      offset += encodedLength;
      decoded += count;
      if (decoded > pixelsPerChannel) {
        throw new Error(
          `ICNS legacy RGB entry ${type} overruns channel ${channel}`
        );
      }
    }
  }
  if (offset !== data.length) {
    throw new Error(`ICNS legacy RGB entry ${type} has trailing data`);
  }
}

export function parseIcns(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < ICNS_HEADER_SIZE ||
    buffer.toString("ascii", 0, 4) !== "icns"
  ) {
    throw new Error("Invalid ICNS header");
  }

  const declaredLength = buffer.readUInt32BE(4);
  if (declaredLength !== buffer.length) {
    throw new Error(
      `ICNS declared length ${declaredLength} does not match ${buffer.length}`
    );
  }

  const entries = [];
  const seen = new Set();
  let offset = ICNS_HEADER_SIZE;
  while (offset < buffer.length) {
    if (buffer.length - offset < ICNS_ENTRY_HEADER_SIZE) {
      throw new Error(`Truncated ICNS entry header at byte ${offset}`);
    }

    const type = buffer.toString("ascii", offset, offset + 4);
    const entryLength = buffer.readUInt32BE(offset + 4);
    if (entryLength < ICNS_ENTRY_HEADER_SIZE) {
      throw new Error(`Invalid ICNS entry length ${entryLength} for ${type}`);
    }

    const end = offset + entryLength;
    if (end > buffer.length) {
      throw new Error(`ICNS entry ${type} extends beyond the file`);
    }
    if (seen.has(type)) {
      throw new Error(`ICNS contains duplicate ${type}`);
    }

    const data = Buffer.from(
      buffer.subarray(offset + ICNS_ENTRY_HEADER_SIZE, end)
    );
    assertEntryData(type, data);
    entries.push({ type, data });
    seen.add(type);
    offset = end;
  }

  return entries;
}

export function encodeIcns(entries) {
  const seen = new Set();
  const chunks = [];

  for (const { type, data } of entries) {
    if (typeof type !== "string" || Buffer.byteLength(type, "ascii") !== 4) {
      throw new Error(`Invalid ICNS entry type: ${String(type)}`);
    }
    if (!Buffer.isBuffer(data)) {
      throw new TypeError(`ICNS entry ${type} data must be a Buffer`);
    }
    if (seen.has(type)) {
      throw new Error(`ICNS contains duplicate ${type}`);
    }

    const header = Buffer.alloc(ICNS_ENTRY_HEADER_SIZE);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(ICNS_ENTRY_HEADER_SIZE + data.length, 4);
    chunks.push(header, data);
    seen.add(type);
  }

  const totalLength =
    ICNS_HEADER_SIZE + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(ICNS_HEADER_SIZE);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...chunks], totalLength);
}

function entriesByType(entries) {
  return new Map(entries.map((entry) => [entry.type, entry]));
}

export function mergeIcnsRenditions(
  completeBuffer,
  legacy16Buffer,
  legacy32Buffer
) {
  const complete = entriesByType(parseIcns(completeBuffer));
  const legacy16 = entriesByType(parseIcns(legacy16Buffer));
  const legacy32 = entriesByType(parseIcns(legacy32Buffer));
  const merged = [];

  for (const type of LEGACY_ICNS_TYPES) {
    const source = type === "is32" || type === "s8mk" ? legacy16 : legacy32;
    const entry = source.get(type);
    if (!entry) {
      throw new Error(`Legacy ICNS is missing ${type}`);
    }
    merged.push(entry);
  }

  for (const [type, expectedSize] of Object.entries(ICNS_DIMENSIONS)) {
    const sourceType = STANDARD_ICNS_SOURCE_TYPES[type] ?? type;
    const entry = complete.get(sourceType);
    if (!entry) {
      throw new Error(`Complete ICNS is missing ${sourceType}`);
    }

    const actualSize = assertPng(type, entry.data);
    if (actualSize !== expectedSize) {
      throw new Error(
        `ICNS entry ${type} is ${actualSize}x${actualSize}; expected ${expectedSize}x${expectedSize}`
      );
    }
    merged.push({ type, data: entry.data });
  }

  return encodeIcns(merged);
}
