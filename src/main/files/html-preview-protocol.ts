import { readFile } from "node:fs/promises";
import {
  HTML_PREVIEW_SCHEME,
  parseHtmlPreviewUrl,
} from "@shared/contracts/file/html-preview-url.ts";

export { HTML_PREVIEW_SCHEME } from "@shared/contracts/file/html-preview-url.ts";

import type { OnBeforeRequestListenerDetails } from "electron";
import { protocol as electronProtocol } from "electron";
import {
  resolveExistingFileIdentity,
  unsupportedFileType,
} from "../services/files/path-identity.ts";
import {
  type HtmlPreviewTicketRegistry,
  htmlPreviewTicketRegistry,
} from "./html-preview-ticket-registry.ts";

interface ProtocolRegistration {
  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>
  ): void;
  registerSchemesAsPrivileged(
    schemes: {
      privileges: {
        corsEnabled: boolean;
        secure: boolean;
        standard: boolean;
        supportFetchAPI: boolean;
      };
      scheme: string;
    }[]
  ): void;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  css: "text/css; charset=utf-8",
  gif: "image/gif",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "text/xml; charset=utf-8",
};

function contentTypeForPath(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) {
    return "application/octet-stream";
  }
  return (
    CONTENT_TYPE_BY_EXTENSION[relPath.slice(dot + 1).toLowerCase()] ??
    "application/octet-stream"
  );
}

function notFound(): Response {
  return new Response(null, {
    headers: { "x-content-type-options": "nosniff" },
    status: 404,
  });
}

function previewResponse(bytes: Buffer, relPath: string): Response {
  return new Response(Uint8Array.from(bytes), {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-length": String(bytes.length),
      "content-type": contentTypeForPath(relPath),
      "x-content-type-options": "nosniff",
    },
  });
}

export async function resolveHtmlPreviewResponse(
  requestUrl: string,
  registry: Pick<HtmlPreviewTicketRegistry, "peek"> = htmlPreviewTicketRegistry
): Promise<Response> {
  try {
    const parsed = parseHtmlPreviewUrl(requestUrl);
    if (!parsed) {
      return notFound();
    }
    const rootRealpath = registry.peek(parsed.ticket);
    if (!rootRealpath) {
      return notFound();
    }
    const identity = await resolveExistingFileIdentity(
      rootRealpath,
      parsed.relPath
    );
    if (unsupportedFileType(identity.stat)) {
      return notFound();
    }
    const bytes = await readFile(identity.canonicalTarget);
    return previewResponse(bytes, parsed.relPath);
  } catch {
    return notFound();
  }
}

export function authorizeHtmlPreviewRequest(
  details: Pick<OnBeforeRequestListenerDetails, "url" | "webContentsId">,
  partition: string,
  registry: Pick<
    HtmlPreviewTicketRegistry,
    "authorize"
  > = htmlPreviewTicketRegistry
): boolean {
  const parsed = parseHtmlPreviewUrl(details.url);
  return Boolean(
    parsed &&
      details.webContentsId !== undefined &&
      registry.authorize(parsed.ticket, {
        partition,
        webContentsId: details.webContentsId,
      })
  );
}

export function registerHtmlPreviewScheme(
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
      scheme: HTML_PREVIEW_SCHEME,
    },
  ]);
}

export function handleHtmlPreviewProtocol(
  protocol: ProtocolRegistration = electronProtocol
): void {
  protocol.handle(HTML_PREVIEW_SCHEME, (request) =>
    resolveHtmlPreviewResponse(request.url)
  );
}
