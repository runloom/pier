export interface PreviewImageDimensions {
  readonly height: number;
  readonly width: number;
}

const PNG_IHDR_OFFSET = 16;
const GIF_SIZE_OFFSET = 6;
const WEBP_14BIT = 16_384;

/**
 * Best-effort width/height from a signature-validated raster buffer.
 * Returns null when the header is truncated or the format variant is unknown.
 */
export function readPreviewImageDimensions(
  bytes: Uint8Array
): PreviewImageDimensions | null {
  if (bytes.length >= PNG_IHDR_OFFSET + 8 && isPng(bytes)) {
    const width = readUint32(bytes, PNG_IHDR_OFFSET, false);
    const height = readUint32(bytes, PNG_IHDR_OFFSET + 4, false);
    return positiveSize(width, height);
  }
  if (bytes.length >= GIF_SIZE_OFFSET + 4 && isGif(bytes)) {
    const width = readUint16(bytes, GIF_SIZE_OFFSET, true);
    const height = readUint16(bytes, GIF_SIZE_OFFSET + 2, true);
    return positiveSize(width, height);
  }
  if (isWebp(bytes)) {
    return readWebpDimensions(bytes);
  }
  if (isJpeg(bytes)) {
    return readJpegDimensions(bytes);
  }
  return null;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isGif(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function readWebpDimensions(bytes: Uint8Array): PreviewImageDimensions | null {
  if (bytes.length < 30) {
    return null;
  }
  const fourcc = String.fromCharCode(
    bytes[12]!,
    bytes[13]!,
    bytes[14]!,
    bytes[15]!
  );
  if (fourcc === "VP8X") {
    const width = 1 + readUint24Le(bytes, 24);
    const height = 1 + readUint24Le(bytes, 27);
    return positiveSize(width, height);
  }
  if (fourcc === "VP8 ") {
    const start = 20;
    if (
      bytes[start] === 0x9d &&
      bytes[start + 1] === 0x01 &&
      bytes[start + 2] === 0x2a
    ) {
      const width = readUint16(bytes, start + 3, true) % WEBP_14BIT;
      const height = readUint16(bytes, start + 5, true) % WEBP_14BIT;
      return positiveSize(width, height);
    }
  }
  if (fourcc === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = readUint32(bytes, 21, true);
    const width = (bits % WEBP_14BIT) + 1;
    const height = (Math.floor(bits / WEBP_14BIT) % WEBP_14BIT) + 1;
    return positiveSize(width, height);
  }
  return null;
}

function readJpegDimensions(bytes: Uint8Array): PreviewImageDimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    let marker = bytes[offset + 1]!;
    while (marker === 0xff) {
      offset += 1;
      if (offset + 1 >= bytes.length) {
        return null;
      }
      marker = bytes[offset + 1]!;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      return null;
    }
    const length = readUint16(bytes, offset, false);
    if (length < 2) {
      return null;
    }
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 7 <= bytes.length) {
      const height = readUint16(bytes, offset + 3, false);
      const width = readUint16(bytes, offset + 5, false);
      return positiveSize(width, height);
    }
    offset += length;
  }
  return null;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean
): number {
  return viewOf(bytes).getUint16(offset, littleEndian);
}

function readUint32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean
): number {
  return viewOf(bytes).getUint32(offset, littleEndian);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  const view = viewOf(bytes);
  return (
    view.getUint8(offset) +
    view.getUint8(offset + 1) * 256 +
    view.getUint8(offset + 2) * 65_536
  );
}

function positiveSize(
  width: number,
  height: number
): PreviewImageDimensions | null {
  if (
    !(
      Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width > 0 &&
      height > 0
    )
  ) {
    return null;
  }
  return { height, width };
}
