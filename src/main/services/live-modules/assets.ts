import { readFileSync } from "node:fs";
import { liveModuleAssetUrlForTicket } from "@shared/live-module-url.ts";
import type * as esbuild from "esbuild";
import { assertPathInsideRoot, LiveModuleFenceError } from "./fence.ts";
import { createLiveModuleTicket } from "./ticket-registry.ts";

/** Inline as a data URL below this size; larger binaries get an asset ticket. */
export const CANVAS_ASSET_DATAURL_MAX_BYTES = 96 * 1024;

/** Go regexp (esbuild onLoad filter) — no unicode flag. */
const ASSET_FILTER = /\.(png|jpe?g|webp|gif|svg|woff2?)$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

export interface CompiledLiveAsset {
  bytes: Buffer;
  mimeType: string;
  ticket: string;
}

export function canvasAssetExtension(filePath: string): string | null {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  return filePath.slice(dot + 1).toLowerCase();
}

export function canvasAssetMimeType(filePath: string): string | null {
  const extension = canvasAssetExtension(filePath);
  return extension ? (MIME_BY_EXTENSION[extension] ?? null) : null;
}

export function isCanvasFontAsset(filePath: string): boolean {
  const extension = canvasAssetExtension(filePath);
  return extension === "woff" || extension === "woff2";
}

/** Fonts always inline (`data:` is already on CSP font-src). */
export function shouldInlineCanvasAsset(
  filePath: string,
  byteLength: number
): boolean {
  return (
    isCanvasFontAsset(filePath) || byteLength <= CANVAS_ASSET_DATAURL_MAX_BYTES
  );
}

export function createCanvasAssetPlugin(opts: {
  assetsRef: { current: CompiledLiveAsset[] };
  fenceRoot: string;
}): esbuild.Plugin {
  return {
    name: "pier-live-canvas-assets",
    setup(build) {
      build.onLoad({ filter: ASSET_FILTER, namespace: "file" }, (args) => {
        let realPath: string;
        try {
          realPath = assertPathInsideRoot(args.path, opts.fenceRoot, "asset");
        } catch (error) {
          if (error instanceof LiveModuleFenceError) {
            return { errors: [{ text: error.diagnosticMessage }] };
          }
          const message =
            error instanceof Error ? error.message : String(error);
          return { errors: [{ text: message }] };
        }

        const mimeType = canvasAssetMimeType(realPath);
        if (!mimeType) {
          return;
        }

        const bytes = readFileSync(realPath);
        if (shouldInlineCanvasAsset(realPath, bytes.byteLength)) {
          return {
            contents: bytes,
            loader: "dataurl",
            watchFiles: [realPath],
          };
        }

        const ticket = createLiveModuleTicket();
        opts.assetsRef.current.push({
          bytes,
          mimeType,
          ticket,
        });
        const url = liveModuleAssetUrlForTicket(ticket);
        return {
          contents: `export default ${JSON.stringify(url)};`,
          loader: "js",
          watchFiles: [realPath],
        };
      });
    },
  };
}
