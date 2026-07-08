import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import type { AssetFetcher } from "./install-operations.ts";

/**
 * Node HTTP(S) asset fetcher. Follows a bounded number of redirects and
 * buffers the whole body in memory (v1 tgz is <1 MB — no need to stream to
 * disk). Sha256 + size verification happens in `performInstall` after this
 * returns.
 */

const MAX_ASSET_BYTES = 10 * 1024 * 1024;

function fetchOnce(url: string): Promise<{
  body: Buffer;
  contentLength: number | null;
  location: string | null;
  status: number;
}> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    body: Buffer;
    contentLength: number | null;
    location: string | null;
    status: number;
  }>();
  const client = new URL(url).protocol === "http:" ? httpGet : httpsGet;
  const req = client(url, (res: IncomingMessage) => {
    const status = res.statusCode ?? 0;
    const location = res.headers.location ?? null;
    const contentLengthHeader = res.headers["content-length"];
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : null;
    // Redirects (3xx): drain and return without a body.
    if (status >= 300 && status < 400 && location) {
      res.resume();
      resolve({ body: Buffer.alloc(0), contentLength, location, status });
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    res.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_ASSET_BYTES) {
        res.destroy();
        reject(
          new Error(
            `asset exceeded max size ${MAX_ASSET_BYTES} bytes: ${received}`
          )
        );
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () =>
      resolve({
        body: Buffer.concat(chunks),
        contentLength,
        location,
        status,
      })
    );
    res.on("error", reject);
  });
  req.on("error", reject);
  return promise;
}

export function createNodeHttpAssetFetcher(): AssetFetcher {
  return async (assetUrl) => {
    const MAX_REDIRECTS = 3;
    let currentUrl = assetUrl;
    let redirectCount = 0;
    for (;;) {
      const res = await fetchOnce(currentUrl);
      if (res.status >= 300 && res.status < 400 && res.location) {
        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(
            `redirect budget exceeded: ${redirectCount} > ${MAX_REDIRECTS}`
          );
        }
        currentUrl = new URL(res.location, currentUrl).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(
          `asset fetch failed with HTTP ${res.status}: ${currentUrl}`
        );
      }
      return {
        body: res.body,
        finalUrl: currentUrl,
        redirectCount,
      };
    }
  };
}
