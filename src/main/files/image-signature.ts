import type { FilePreviewImageMime } from "@shared/contracts/file.ts";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const IMAGE_SIGNATURE_BYTES = 12;

export function classifyPreviewImageSignature(
  bytes: Uint8Array
): FilePreviewImageMime | null {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  const gif = header.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") {
    return "image/gif";
  }
  if (
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
