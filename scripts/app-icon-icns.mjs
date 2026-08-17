import { Buffer } from "node:buffer";
import { crc32, inflateSync } from "node:zlib";

const ICNS_HEADER_SIZE = 8;
const ICNS_ENTRY_HEADER_SIZE = 8;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const ICNS_DIMENSIONS = Object.freeze({
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
});

export const MICRO_ICNS_TYPES = Object.freeze([
  "icp4",
  "icp5",
  "icp6",
  "ic07",
  "ic11",
  "ic12",
]);

export const STANDARD_ICNS_TYPES = Object.freeze([
  "ic08",
  "ic09",
  "ic10",
  "ic13",
  "ic14",
]);

const STANDARD_ICNS_SOURCE_TYPES = Object.freeze({
  ic08: "ic08",
  ic09: "ic09",
  ic10: "ic10",
  ic13: "ic08",
  ic14: "ic09",
});

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
      const compression = data[dataStart + 10];
      const filter = data[dataStart + 11];
      const interlace = data[dataStart + 12];
      if (
        width === 0 ||
        height === 0 ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        throw new Error(`ICNS entry ${type} has unsupported PNG metadata`);
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
  try {
    inflateSync(Buffer.concat(idatChunks));
  } catch (error) {
    throw new Error(`ICNS entry ${type} has invalid PNG image data`, {
      cause: error,
    });
  }
  if (width !== height) {
    throw new Error(`ICNS entry ${type} PNG is not square: ${width}x${height}`);
  }
  return width;
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
    assertPng(type, data);
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

export function mergeIcnsRenditions(standardBuffer, microBuffer) {
  const standard = entriesByType(parseIcns(standardBuffer));
  const micro = entriesByType(parseIcns(microBuffer));
  const microTypes = new Set(MICRO_ICNS_TYPES);
  const merged = [];

  for (const [type, expectedSize] of Object.entries(ICNS_DIMENSIONS)) {
    const useMicro = microTypes.has(type);
    const source = useMicro ? micro : standard;
    const sourceType = useMicro ? type : STANDARD_ICNS_SOURCE_TYPES[type];
    const entry = source.get(sourceType);
    if (!entry) {
      throw new Error(
        `${useMicro ? "Micro" : "Standard"} ICNS is missing ${sourceType}`
      );
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
