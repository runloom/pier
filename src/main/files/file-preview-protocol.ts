import {
  fileRootSchema,
  nonEmptyFileRootRelativePathSchema,
} from "@shared/contracts/file.ts";
import { FILE_PREVIEW_SCHEME } from "@shared/file-preview-url.ts";
import { protocol as electronProtocol } from "electron";
import {
  resolveExistingFileIdentity,
  revisionForFileBytes,
  unsupportedFileType,
} from "../services/file-path-identity.ts";
import {
  MAX_IMAGE_PREVIEW_FILE_BYTES,
  readFileWithinImagePreviewLimit,
} from "./image-preview-file.ts";
import { classifyPreviewImageSignature } from "./image-signature.ts";

export {
  createFilePreviewUrl,
  FILE_PREVIEW_SCHEME,
} from "@shared/file-preview-url.ts";

interface ProtocolRegistration {
  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>
  ): void;
  registerSchemesAsPrivileged(
    schemes: {
      privileges: {
        secure: boolean;
        standard: boolean;
        supportFetchAPI: boolean;
      };
      scheme: string;
    }[]
  ): void;
}

function decode(value: string | null): string {
  if (!value) {
    throw new Error("missing file preview locator");
  }
  return Buffer.from(value, "base64url").toString("utf8");
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

export async function resolveFilePreviewResponse(
  requestUrl: string
): Promise<Response> {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${FILE_PREVIEW_SCHEME}:` || url.host !== "file") {
      return notFound();
    }
    const root = fileRootSchema.parse(decode(url.searchParams.get("root")));
    const path = nonEmptyFileRootRelativePathSchema.parse(
      decode(url.searchParams.get("path"))
    );
    const requestedRevision = url.searchParams.get("revision");
    if (!requestedRevision) {
      return notFound();
    }
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
    const mime = classifyPreviewImageSignature(bytes);
    if (!mime) {
      return notFound();
    }
    const revision = revisionForFileBytes(identity, bytes);
    if (revision !== requestedRevision) {
      return new Response(null, {
        headers: { "x-content-type-options": "nosniff" },
        status: 409,
      });
    }
    return new Response(bytes, {
      headers: {
        "cache-control": "private, immutable",
        "content-length": String(bytes.length),
        "content-type": mime,
        etag: `"${revision}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}

export function registerFilePreviewScheme(
  protocol: ProtocolRegistration = electronProtocol
): void {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: { secure: true, standard: true, supportFetchAPI: true },
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
