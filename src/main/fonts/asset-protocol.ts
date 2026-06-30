import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { protocol } from "electron";
import { assetRootDir } from "./asset-paths.ts";

export const ASSET_SCHEME = "pier-asset";

// 路径净化 regex 提到顶层，避免每次请求重新编译 (biome lint/performance/useTopLevelRegex)
const LEADING_PARENT_DIRS = /^(\.\.[/\\])+/;
const LEADING_SLASHES = /^[/\\]+/;

/** app ready 之前调用：声明 scheme 为 privileged，否则 @font-face 加载会被安全策略拦。 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** app ready 之后调用：把 pier-asset://fonts/<file> 映射到 resources/fonts/<file>。 */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = normalize(url.pathname)
      .replace(LEADING_PARENT_DIRS, "")
      .replace(LEADING_SLASHES, "");
    if (url.host !== "fonts" || !file.endsWith(".ttf")) {
      return new Response(null, { status: 404 });
    }
    try {
      const buf = await readFile(join(assetRootDir(), file));
      return new Response(buf, { headers: { "content-type": "font/ttf" } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
