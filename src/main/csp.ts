import { app, session } from "electron";

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
export function installCsp(): void {
  const isDev = !app.isPackaged;

  const policy = isDev
    ? [
        "default-src 'self' http://localhost:* ws://localhost:*",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self' http://localhost:* ws://localhost:*",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' data:",
        "font-src 'self' data:",
      ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}
