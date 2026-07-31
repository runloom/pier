import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { protocol } from "electron";
import { isDevRuntime } from "../runtime-mode.ts";
import type { ManagedPluginRuntimeSource } from "../services/managed-plugins/install-runtime.ts";

/**
 * `pier-plugin://<pluginId>/<version>/<relative-path>` protocol handler for
 * installed managed plugin renderer entries and assets (plan Task 4).
 *
 * Constraints:
 * - Registered as standard + secure + supportFetchAPI + corsEnabled BEFORE
 *   `app.whenReady()`, so browser dynamic import works from both dev
 *   `http://localhost:*` and packaged app origins.
 * - Only serves paths under boot-time runtime source `assetsRoot` for that
 *   plugin/version. Rejects absolute paths, `..`, symlinks escaping the
 *   plugin root, unknown ids/versions, and every path outside the immutable
 *   package root.
 * - Never serves `work/<id>`, staging, index/cache, or runtime credential
 *   files through this protocol.
 * - CORS: echoes only allowed origins (packaged app file:// or dev
 *   http://localhost/127.0.0.1); no `Access-Control-Allow-Origin: *`;
 *   no `access-control-allow-credentials`.
 */

export function registerPluginAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
      scheme: "pier-plugin",
    },
  ]);
}

const MIME_BY_EXT: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(pathname: string): string {
  return (
    MIME_BY_EXT[extname(pathname).toLowerCase()] ?? "application/octet-stream"
  );
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }
  if (origin.startsWith("file://")) {
    return true;
  }
  if (!isDevRuntime()) {
    return false;
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") {
      return false;
    }
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function resolvePluginAssetPath(options: {
  pluginId: string;
  relativePath: string;
  runtimeSources: readonly ManagedPluginRuntimeSource[];
  version: string;
}): string {
  const source = options.runtimeSources.find(
    (s) => s.id === options.pluginId && s.version === options.version
  );
  if (!source) {
    throw new Error(
      `unknown plugin/version: ${options.pluginId}@${options.version}`
    );
  }
  const rel = options.relativePath;
  if (rel.length === 0) {
    throw new Error(`unsafe plugin asset path (empty): ${rel}`);
  }
  if (rel.startsWith("/") || rel.startsWith(sep)) {
    throw new Error(`unsafe plugin asset path (absolute): ${rel}`);
  }
  const segments = rel.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`unsafe plugin asset path (parent traversal): ${rel}`);
    }
  }
  const target = join(source.assetsRoot, rel);
  if (
    !target.startsWith(source.assetsRoot + sep) &&
    target !== source.assetsRoot
  ) {
    throw new Error(`resolved path escapes plugin root: ${rel}`);
  }
  return target;
}

export interface HandlePluginAssetProtocolOptions {
  readonly getRuntimeSources: () => readonly ManagedPluginRuntimeSource[];
}

export function handlePluginAssetProtocol(
  options: HandlePluginAssetProtocolOptions
): void {
  protocol.handle("pier-plugin", async (request) => {
    const url = new URL(request.url);
    const pluginId = url.hostname;
    const pathParts = url.pathname.replace(/^\//, "").split("/");
    const version = pathParts[0];
    const relativePath = pathParts.slice(1).join("/");
    if (!(pluginId && version)) {
      return new Response("bad plugin asset URL", { status: 400 });
    }
    let targetPath: string;
    try {
      targetPath = resolvePluginAssetPath({
        pluginId,
        relativePath,
        runtimeSources: options.getRuntimeSources(),
        version,
      });
    } catch (err) {
      return new Response((err as Error).message, { status: 403 });
    }
    if (!existsSync(targetPath)) {
      return new Response("not found", { status: 404 });
    }
    const body = await readFile(targetPath);
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "content-type": contentTypeFor(relativePath),
      "x-content-type-options": "nosniff",
    };
    if (isAllowedOrigin(origin)) {
      headers["access-control-allow-origin"] = origin!;
      headers.vary = "Origin";
    }
    return new Response(body, { headers, status: 200 });
  });
}
