/**
 * SPA 静态托管：同端口 Web 壳分发（M1 内部切片，规格 §9）。
 * 路径 normalize 后必须仍在 distDir 内（防 .. 穿越），否则 404；
 * 缓存：html no-cache，/assets/** immutable。
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const MIME_BY_EXT: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

function writeText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

export function createSpaStaticHandler(
  distDir: string
): (req: IncomingMessage, res: ServerResponse) => void {
  const root = resolve(distDir);
  const assetsPrefix = join(root, "assets") + sep;

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      writeText(res, 405, "method not allowed");
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname
      );
    } catch {
      writeText(res, 404, "not found");
      return;
    }
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + sep)) {
      writeText(res, 404, "not found");
      return;
    }
    serve(req, res, target).catch(() => undefined);
  };

  async function serve(
    req: IncomingMessage,
    res: ServerResponse,
    target: string
  ): Promise<void> {
    let filePath = target;
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }
    if (!info?.isFile()) {
      writeText(res, 404, "not found");
      return;
    }
    const ext = extname(filePath).toLowerCase();
    const immutable = ext !== ".html" && filePath.startsWith(assetsPrefix);
    const headers = {
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-length": info.size,
      "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    // stat 与 open 之间存在 TOCTOU 窗口（文件被删/权限变更）：
    // 未写头 → 404；已写头 → 只能 destroy 中止。
    const stream = createReadStream(filePath);
    stream.once("error", () => {
      if (res.headersSent) {
        res.destroy();
      } else {
        writeText(res, 404, "not found");
      }
    });
    stream.once("open", () => {
      res.writeHead(200, headers);
      stream.pipe(res);
    });
  }
}
