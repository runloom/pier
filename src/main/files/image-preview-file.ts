import { open } from "node:fs/promises";
import type { FilePreviewImageMime } from "@shared/contracts/file.ts";
import {
  classifyPreviewImageSignature,
  IMAGE_SIGNATURE_BYTES,
} from "./image-signature.ts";

export const MAX_IMAGE_PREVIEW_FILE_BYTES = 64 * 1024 * 1024;

export async function readPreviewImageMime(
  path: string
): Promise<FilePreviewImageMime | null> {
  const handle = await open(path, "r");
  const header = Buffer.alloc(IMAGE_SIGNATURE_BYTES);
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return classifyPreviewImageSignature(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function readFileWithinImagePreviewLimit(
  path: string,
  expectedSize: number
): Promise<Buffer<ArrayBuffer> | null> {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0 ||
    expectedSize > MAX_IMAGE_PREVIEW_FILE_BYTES
  ) {
    return null;
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
      return null;
    }
    return offset === expectedSize
      ? bytes
      : Buffer.from(bytes.subarray(0, offset));
  } finally {
    await handle.close();
  }
}
