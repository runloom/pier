export const DOCUMENT_ZIP_LIMITS = {
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
} as const;

export type ZipGuardFailure =
  | "truncated"
  | "too-many-entries"
  | "entry-too-large"
  | "total-too-large";

type ZipGuardResult = { ok: true } | { ok: false; reason: ZipGuardFailure };

interface CentralDirectoryInfo {
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  totalEntries: number;
}

const EOCD_SIGNATURE = 0x06_05_4b_50;
const ZIP64_EOCD_SIGNATURE = 0x06_06_4b_50;
const ZIP64_LOCATOR_SIGNATURE = 0x07_06_4b_50;
const CENTRAL_HEADER_SIGNATURE = 0x02_01_4b_50;
const ZIP64_EXTRA_ID = 0x00_01;
const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const CENTRAL_HEADER_SIZE = 46;
const MAX_U16 = 0xff_ff;
const MAX_U32 = 0xff_ff_ff_ff;

function readU16(view: DataView, offset: number): number | null {
  return offset >= 0 && offset + 2 <= view.byteLength
    ? view.getUint16(offset, true)
    : null;
}

function readU32(view: DataView, offset: number): number | null {
  return offset >= 0 && offset + 4 <= view.byteLength
    ? view.getUint32(offset, true)
    : null;
}

function readU64(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 8 > view.byteLength) {
    return null;
  }
  const value = view.getBigUint64(offset, true);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function findEocdOffset(view: DataView): number | null {
  const start = Math.max(0, view.byteLength - (EOCD_MIN_SIZE + MAX_U16));
  for (
    let offset = view.byteLength - EOCD_MIN_SIZE;
    offset >= start;
    offset -= 1
  ) {
    if (readU32(view, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return null;
}

function readZip64Directory(
  view: DataView,
  eocdOffset: number
): CentralDirectoryInfo | null {
  const locatorOffset = eocdOffset - ZIP64_LOCATOR_SIZE;
  if (readU32(view, locatorOffset) !== ZIP64_LOCATOR_SIGNATURE) {
    return null;
  }
  const zip64Offset = readU64(view, locatorOffset + 8);
  if (zip64Offset === null) {
    return null;
  }
  if (readU32(view, zip64Offset) !== ZIP64_EOCD_SIGNATURE) {
    return null;
  }
  const totalEntries = readU64(view, zip64Offset + 32);
  const centralDirectorySize = readU64(view, zip64Offset + 40);
  const centralDirectoryOffset = readU64(view, zip64Offset + 48);
  if (
    totalEntries === null ||
    centralDirectorySize === null ||
    centralDirectoryOffset === null
  ) {
    return null;
  }
  return { centralDirectoryOffset, centralDirectorySize, totalEntries };
}

function directoryInfo(
  view: DataView,
  eocdOffset: number
): CentralDirectoryInfo | null {
  const entriesOnDisk = readU16(view, eocdOffset + 8);
  const totalEntries = readU16(view, eocdOffset + 10);
  const centralDirectorySize = readU32(view, eocdOffset + 12);
  const centralDirectoryOffset = readU32(view, eocdOffset + 16);
  if (
    entriesOnDisk === null ||
    totalEntries === null ||
    centralDirectorySize === null ||
    centralDirectoryOffset === null
  ) {
    return null;
  }
  if (
    entriesOnDisk === MAX_U16 ||
    totalEntries === MAX_U16 ||
    centralDirectorySize === MAX_U32 ||
    centralDirectoryOffset === MAX_U32
  ) {
    return readZip64Directory(view, eocdOffset);
  }
  return { centralDirectoryOffset, centralDirectorySize, totalEntries };
}

function zip64UncompressedSize(
  view: DataView,
  extraOffset: number,
  extraLength: number
): number | null {
  let cursor = extraOffset;
  const end = extraOffset + extraLength;
  while (cursor + 4 <= end) {
    const id = readU16(view, cursor);
    const size = readU16(view, cursor + 2);
    if (id === null || size === null) {
      return null;
    }
    if (id === ZIP64_EXTRA_ID) {
      return readU64(view, cursor + 4);
    }
    cursor += 4 + size;
  }
  return null;
}

/**
 * Read the central directory without inflating anything. Any structural
 * surprise fails closed as `truncated`.
 */
export function inspectZipCentralDirectory(bytes: Uint8Array): ZipGuardResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(view);
  if (eocdOffset === null) {
    return { ok: false, reason: "truncated" };
  }
  const info = directoryInfo(view, eocdOffset);
  if (!info) {
    return { ok: false, reason: "truncated" };
  }
  if (info.totalEntries > DOCUMENT_ZIP_LIMITS.maxEntries) {
    return { ok: false, reason: "too-many-entries" };
  }
  const directoryEnd = info.centralDirectoryOffset + info.centralDirectorySize;
  if (
    info.centralDirectoryOffset < 0 ||
    directoryEnd > view.byteLength ||
    directoryEnd > eocdOffset
  ) {
    return { ok: false, reason: "truncated" };
  }

  let cursor = info.centralDirectoryOffset;
  let totalUncompressed = 0;
  for (let entry = 0; entry < info.totalEntries; entry += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > directoryEnd) {
      return { ok: false, reason: "truncated" };
    }
    if (readU32(view, cursor) !== CENTRAL_HEADER_SIGNATURE) {
      return { ok: false, reason: "truncated" };
    }
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    if (nameLength === null || extraLength === null || commentLength === null) {
      return { ok: false, reason: "truncated" };
    }
    let uncompressedSize = readU32(view, cursor + 24);
    if (uncompressedSize === null) {
      return { ok: false, reason: "truncated" };
    }
    if (uncompressedSize === MAX_U32) {
      uncompressedSize = zip64UncompressedSize(
        view,
        cursor + CENTRAL_HEADER_SIZE + nameLength,
        extraLength
      );
      if (uncompressedSize === null) {
        return { ok: false, reason: "truncated" };
      }
    }
    if (uncompressedSize > DOCUMENT_ZIP_LIMITS.maxEntryUncompressedBytes) {
      return { ok: false, reason: "entry-too-large" };
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > DOCUMENT_ZIP_LIMITS.maxTotalUncompressedBytes) {
      return { ok: false, reason: "total-too-large" };
    }
    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  if (cursor > directoryEnd) {
    return { ok: false, reason: "truncated" };
  }
  return { ok: true };
}
