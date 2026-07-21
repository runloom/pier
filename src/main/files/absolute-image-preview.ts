import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { AbsoluteFilePreviewTicketLocator } from "@shared/contracts/file-preview-ticket.ts";
import { unsupportedFileType } from "../services/file-path-identity.ts";
import {
  MAX_IMAGE_PREVIEW_FILE_BYTES,
  readFileWithinImagePreviewLimit,
} from "./image-preview-file.ts";
import { classifyPreviewImageSignature } from "./image-signature.ts";

export type AbsoluteImagePreviewResolveFailure =
  | "not-found"
  | "too-large"
  | "unsupported";

export type AbsoluteImagePreviewResolveResult =
  | {
      bytes: Buffer;
      canonicalPath: string;
      locator: AbsoluteFilePreviewTicketLocator;
      ok: true;
    }
  | { ok: false; reason: AbsoluteImagePreviewResolveFailure };

function revisionForAbsoluteImage(
  canonicalPath: string,
  info: Awaited<ReturnType<typeof stat>>,
  bytes: Buffer
): string {
  const payload = JSON.stringify({
    canonicalPath,
    contentsSha256: createHash("sha256").update(bytes).digest("hex"),
    dev: info.dev,
    ino: info.ino,
    mode: info.mode,
    size: info.size,
  });
  return `abs-v1:${createHash("sha256").update(payload).digest("hex")}`;
}

/**
 * Resolve an absolute filesystem path into a signature-validated image locator
 * plus bytes. Used by host media-preview issue and the protocol serve path.
 */
export async function resolveAbsoluteImagePreview(
  absolutePath: string
): Promise<AbsoluteImagePreviewResolveResult> {
  if (!isAbsolute(absolutePath)) {
    return { ok: false, reason: "unsupported" };
  }
  let canonicalPath: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    canonicalPath = await realpath(absolutePath);
    info = await stat(canonicalPath);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (unsupportedFileType(info)) {
    return { ok: false, reason: "unsupported" };
  }
  if (info.size > MAX_IMAGE_PREVIEW_FILE_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  const bytes = await readFileWithinImagePreviewLimit(canonicalPath, info.size);
  if (!bytes) {
    return { ok: false, reason: "too-large" };
  }
  const mime = classifyPreviewImageSignature(bytes);
  if (!mime) {
    return { ok: false, reason: "unsupported" };
  }
  return {
    ok: true,
    bytes,
    canonicalPath,
    locator: {
      absolutePath: canonicalPath,
      mime,
      revision: revisionForAbsoluteImage(canonicalPath, info, bytes),
    },
  };
}
