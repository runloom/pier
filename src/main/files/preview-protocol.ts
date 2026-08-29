import {
  FILE_PREVIEW_SCHEME,
  filePreviewTicketFromUrl,
} from "@shared/file-preview-url.ts";

export { FILE_PREVIEW_SCHEME } from "@shared/file-preview-url.ts";

import {
  isAbsoluteFilePreviewLocator,
  isGitBlobFilePreviewLocator,
} from "@shared/contracts/file/preview-ticket.ts";
import type { OnBeforeRequestListenerDetails } from "electron";
import { protocol as electronProtocol } from "electron";
import {
  resolveExistingFileIdentity,
  revisionForFileBytes,
  unsupportedFileType,
} from "../services/files/path-identity.ts";
import { resolveAbsoluteImagePreview } from "./absolute-image-preview.ts";
import { resolveGitBlobImagePreview } from "./git-blob-image-preview.ts";
import {
  MAX_IMAGE_PREVIEW_FILE_BYTES,
  readFileWithinImagePreviewLimit,
} from "./image-preview-file.ts";
import {
  classifyPreviewImageSignature,
  classifyPreviewSvgMarkup,
} from "./image-signature.ts";
import {
  type FilePreviewTicketRegistry,
  filePreviewTicketRegistry,
} from "./preview-ticket-registry.ts";

interface ProtocolRegistration {
  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>
  ): void;
  registerSchemesAsPrivileged(
    schemes: {
      privileges: {
        corsEnabled?: boolean;
        secure: boolean;
        standard: boolean;
        supportFetchAPI: boolean;
      };
      scheme: string;
    }[]
  ): void;
}

function notFound(): Response {
  return new Response(null, {
    headers: { "x-content-type-options": "nosniff" },
    status: 404,
  });
}

function payloadTooLarge(): Response {
  return new Response(null, {
    headers: { "x-content-type-options": "nosniff" },
    status: 413,
  });
}

function conflict(): Response {
  return new Response(null, {
    headers: { "x-content-type-options": "nosniff" },
    status: 409,
  });
}

function imageResponse(
  bytes: Buffer,
  mime: string,
  revision: string
): Response {
  return new Response(Uint8Array.from(bytes), {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "private, immutable",
      "content-length": String(bytes.length),
      "content-type": mime,
      etag: `"${revision}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function resolveFilePreviewResponse(
  requestUrl: string,
  registry: Pick<FilePreviewTicketRegistry, "peek"> = filePreviewTicketRegistry
): Promise<Response> {
  try {
    const ticket = filePreviewTicketFromUrl(requestUrl);
    const entry = ticket ? registry.peek(ticket) : null;
    if (!entry) {
      return notFound();
    }
    if (isAbsoluteFilePreviewLocator(entry.locator)) {
      const resolved = await resolveAbsoluteImagePreview(
        entry.locator.absolutePath
      );
      if (!resolved.ok) {
        return resolved.reason === "too-large" ? payloadTooLarge() : notFound();
      }
      if (
        resolved.locator.mime !== entry.locator.mime ||
        resolved.locator.revision !== entry.locator.revision ||
        resolved.canonicalPath !== entry.locator.absolutePath
      ) {
        return conflict();
      }
      return imageResponse(
        resolved.bytes,
        resolved.locator.mime,
        resolved.locator.revision
      );
    }
    if (isGitBlobFilePreviewLocator(entry.locator)) {
      const resolved = await resolveGitBlobImagePreview({
        gitRoot: entry.locator.gitRoot,
        oid: entry.locator.oid,
      });
      if (!resolved.ok) {
        if (resolved.reason === "too-large") {
          return payloadTooLarge();
        }
        return notFound();
      }
      if (
        resolved.mime !== entry.locator.mime ||
        resolved.revision !== entry.locator.revision
      ) {
        return conflict();
      }
      return imageResponse(resolved.bytes, resolved.mime, resolved.revision);
    }
    const { path, revision: requestedRevision, root } = entry.locator;
    const identity = await resolveExistingFileIdentity(root, path);
    if (unsupportedFileType(identity.stat)) {
      return notFound();
    }
    if (identity.stat.size > MAX_IMAGE_PREVIEW_FILE_BYTES) {
      return payloadTooLarge();
    }
    const bytes = await readFileWithinImagePreviewLimit(
      identity.canonicalTarget,
      identity.stat.size
    );
    if (!bytes) {
      return payloadTooLarge();
    }
    const mime =
      entry.locator.mime === "image/svg+xml"
        ? classifyPreviewSvgMarkup(bytes)
        : classifyPreviewImageSignature(bytes);
    if (!mime || mime !== entry.locator.mime) {
      return notFound();
    }
    const revision = revisionForFileBytes(identity, bytes);
    if (revision !== requestedRevision) {
      return conflict();
    }
    return imageResponse(bytes, mime, revision);
  } catch {
    return notFound();
  }
}

export function authorizeFilePreviewRequest(
  details: Pick<OnBeforeRequestListenerDetails, "url" | "webContentsId">,
  partition: string,
  registry: Pick<
    FilePreviewTicketRegistry,
    "resolveRequest"
  > = filePreviewTicketRegistry
): boolean {
  const ticket = filePreviewTicketFromUrl(details.url);
  return Boolean(
    ticket &&
      details.webContentsId !== undefined &&
      registry.resolveRequest(ticket, {
        partition,
        webContentsId: details.webContentsId,
      })
  );
}

export function registerFilePreviewScheme(
  protocol: ProtocolRegistration = electronProtocol
): void {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
      scheme: FILE_PREVIEW_SCHEME,
    },
  ]);
}

export function handleFilePreviewProtocol(
  protocol: ProtocolRegistration = electronProtocol
): void {
  protocol.handle(FILE_PREVIEW_SCHEME, (request) =>
    resolveFilePreviewResponse(request.url)
  );
}
