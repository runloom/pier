import { open } from "node:fs/promises";
import { MAX_FILE_PREVIEW_BYTES } from "@shared/contracts/file/document.ts";

export { MAX_FILE_PREVIEW_BYTES } from "@shared/contracts/file/document.ts";

/** Read at most `byteCount` bytes from the start of a file. */
export async function readFileHeader(
  path: string,
  byteCount: number
): Promise<Uint8Array> {
  const handle = await open(path, "r");
  const header = Buffer.alloc(byteCount);
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return Uint8Array.from(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export type BoundedPreviewRead =
  | { bytes: Buffer<ArrayBuffer>; kind: "ok" }
  | { kind: "changed" }
  | { kind: "too-large" };

/**
 * Read exactly the inspected byte count, refusing files that grew or exceed
 * the preview ceiling. A file that merely changed while being read is
 * reported as `changed` so callers can answer 409 (reload) instead of 413
 * ("too large") — the latter would send the user to the wrong next step.
 */
export async function readFileWithinPreviewLimit(
  path: string,
  expectedSize: number
): Promise<BoundedPreviewRead> {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0 ||
    expectedSize > MAX_FILE_PREVIEW_BYTES
  ) {
    return { kind: "too-large" };
  }

  const handle = await open(path, "r");
  try {
    const bytes = Buffer.allocUnsafe(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const result = await handle.read(
        bytes,
        offset,
        expectedSize - offset,
        offset
      );
      if (result.bytesRead === 0) {
        break;
      }
      offset += result.bytesRead;
    }

    // The file may have grown after its metadata was inspected. Probe one byte
    // beyond the bounded allocation instead of falling back to an unbounded read.
    const growthProbe = Buffer.allocUnsafe(1);
    const { bytesRead: grew } = await handle.read(growthProbe, 0, 1, offset);
    if (grew !== 0) {
      return { kind: "changed" };
    }
    return offset === expectedSize
      ? { bytes, kind: "ok" }
      : { bytes: Buffer.from(bytes.subarray(0, offset)), kind: "ok" };
  } finally {
    await handle.close();
  }
}
