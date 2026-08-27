import { session } from "electron";
import { isDevRuntime } from "./runtime-mode.ts";

/**
 * 注入 Content-Security-Policy 头.
 *
 * Dev mode (vite HMR + react-refresh):
 *   - 允许 ws://localhost / http://localhost (vite dev + HMR websocket)
 *   - 'unsafe-inline' + 'unsafe-eval' (react-refresh + vite client 需要)
 *
 * Prod mode (file:// 加载):
 *   - 严格 'self'，禁止 'unsafe-eval'
 *   - 允许 'wasm-unsafe-eval'：Pierre / Shiki oniguruma WASM 高亮需要
 *     WebAssembly.compile / instantiate（dev 的 'unsafe-eval' 已覆盖）
 */
export function buildCspPolicy(isDev: boolean): string {
  return isDev
    ? [
        "default-src 'self' http://localhost:* ws://localhost:*",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' http://localhost:* pier-plugin: pier-live:",
        "style-src 'self' 'unsafe-inline' pier-plugin: pier-live:",
        "connect-src 'self' http://localhost:* ws://localhost:* pier-live:",
        "img-src 'self' data: blob: pier-plugin: pier-file-preview: pier-live:",
        "font-src 'self' data: pier-asset: pier-plugin: pier-live:",
        "media-src 'self' pier-asset:",
        "frame-src 'self' pier-html-preview:",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval' pier-plugin: pier-live:",
        "style-src 'self' 'unsafe-inline' pier-plugin: pier-live:",
        "connect-src 'self' pier-live:",
        "img-src 'self' data: pier-plugin: pier-file-preview: pier-live:",
        "font-src 'self' data: pier-asset: pier-plugin: pier-live:",
        "media-src 'self' pier-asset:",
        "frame-src 'self' pier-html-preview:",
      ].join("; ");
}

/**
 * HTML 预览文档（pier-html-preview:）不注入宿主 CSP：沙箱 iframe 是唯一隔离线
 * （sandbox="allow-scripts"，无 allow-same-origin），预览页需放行 inline script /
 * CDN / fetch；宿主页面与其余 scheme 一律覆写。
 */
export function shouldApplyAppCsp(url: string): boolean {
  return !url.startsWith("pier-html-preview:");
}

export function installCsp(): void {
  const policy = buildCspPolicy(isDevRuntime());

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldApplyAppCsp(details.url)) {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}
