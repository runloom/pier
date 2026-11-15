import { open } from "node:fs/promises";
import { MAX_FILE_PREVIEW_BYTES } from "@shared/contracts/file/document.ts";
import type { FilePreviewImageMime } from "@shared/contracts/file.ts";
import {
  classifyPreviewImageSignature,
  IMAGE_SIGNATURE_BYTES,
} from "./image-signature.ts";
import {
  type BoundedPreviewRead,
  readFileWithinPreviewLimit,
} from "./preview-file.ts";

export const MAX_IMAGE_PREVIEW_FILE_BYTES = MAX_FILE_PREVIEW_BYTES;

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

/** Image previews share the generic bounded preview read. */
export function readFileWithinImagePreviewLimit(
  path: string,
  expectedSize: number
): Promise<BoundedPreviewRead> {
  return readFileWithinPreviewLimit(path, expectedSize);
}
