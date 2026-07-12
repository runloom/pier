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
 *   - 严格 'self'
 */
export function buildCspPolicy(isDev: boolean): string {
  return isDev
    ? [
        "default-src 'self' http://localhost:* ws://localhost:*",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* pier-plugin:",
        "style-src 'self' 'unsafe-inline' pier-plugin:",
        "connect-src 'self' http://localhost:* ws://localhost:*",
        "img-src 'self' data: blob: pier-plugin: pier-file-preview:",
        "font-src 'self' data: pier-asset: pier-plugin:",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self' pier-plugin:",
        "style-src 'self' 'unsafe-inline' pier-plugin:",
        "connect-src 'self'",
        "img-src 'self' data: pier-plugin: pier-file-preview:",
        "font-src 'self' data: pier-asset: pier-plugin:",
      ].join("; ");
}

export function installCsp(): void {
  const policy = buildCspPolicy(isDevRuntime());

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}
