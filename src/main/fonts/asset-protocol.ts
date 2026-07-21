import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { protocol } from "electron";
import { resolveBundledSoundAbsolutePath } from "../sounds/sound-asset-paths.ts";
import { assetRootDir } from "./asset-paths.ts";

export const ASSET_SCHEME = "pier-asset";

// 路径净化 regex 提到顶层，避免每次请求重新编译 (biome lint/performance/useTopLevelRegex)
const LEADING_PARENT_DIRS = /^(\.\.[/\\])+/;
const LEADING_SLASHES = /^[/\\]+/;

// 字体内容缓存：首屏多个 @font-face 会请求同一 8MB ttf 多次，
// 缓存避免重复读盘 (每次仍 new Response 包裹同一 Buffer)。
const fontCache = new Map<string, Buffer<ArrayBuffer>>();
const soundCache = new Map<string, Buffer<ArrayBuffer>>();

/**
 * app ready 之前调用：声明 scheme 为 privileged，否则 @font-face 加载会被安全策略拦。
 * `stream: true` 是 HTMLAudio/HTMLVideo 走自定义协议的硬性要求：
 * 缺失时媒体元素一律 NotSupportedError（fetch/字体不受影响，易漏测）。
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * app ready 之后调用：
 * - pier-asset://fonts/<file.ttf> → resources/fonts
 * - pier-asset://sounds/<catalog.wav> → resources/notification-sounds
 */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = normalize(url.pathname)
      .replace(LEADING_PARENT_DIRS, "")
      .replace(LEADING_SLASHES, "");

    if (url.host === "fonts" && file.endsWith(".ttf")) {
      const cached = fontCache.get(file);
      if (cached) {
        return new Response(cached, {
          headers: { "content-type": "font/ttf" },
        });
      }
      try {
        const buf = await readFile(join(assetRootDir(), file));
        fontCache.set(file, buf);
        return new Response(buf, { headers: { "content-type": "font/ttf" } });
      } catch {
        return new Response(null, { status: 404 });
      }
    }

    if (url.host === "sounds") {
      const absolute = resolveBundledSoundAbsolutePath(file);
      if (!absolute) {
        console.warn("[pier-asset] 拒绝非法音效请求:", request.url);
        return new Response(null, { status: 404 });
      }
      const cached = soundCache.get(file);
      if (cached) {
        return new Response(cached, {
          headers: { "content-type": "audio/wav" },
        });
      }
      try {
        const buf = await readFile(absolute);
        soundCache.set(file, buf);
        return new Response(buf, { headers: { "content-type": "audio/wav" } });
      } catch {
        return new Response(null, { status: 404 });
      }
    }

    console.warn("[pier-asset] 拒绝非法资源请求:", request.url);
    return new Response(null, { status: 404 });
  });
}
