import type {
  DocumentOriginFetchRequest,
  DocumentOriginFetchResult,
} from "@pier/plugin-api/main";
import { BrowserWindow } from "electron";

export type {
  DocumentOriginFetchRequest,
  DocumentOriginFetchResult,
} from "@pier/plugin-api/main";

const ORIGIN_FETCH_TIMEOUT_MS = 8000;
const CF_WAIT_MS = 3000;
const ISOLATED_WORLD_ID = 1000;
const ALLOWED_DOCUMENT_ORIGINS = new Set(["https://grok.com"]);
const ALLOWED_HEADER_NAMES = new Set([
  "accept",
  "authorization",
  "content-type",
  "x-grpc-web",
  "x-grok-client-mode",
  "x-userid",
  "x-xai-token-auth",
]);

const windows = new Map<string, BrowserWindow>();
const inflight = new Map<string, Promise<BrowserWindow>>();

function abortError(): Error {
  const error = new Error("document origin fetch aborted");
  error.name = "AbortError";
  return error;
}

export function assertDocumentOriginRequest(request: {
  origin: string;
  url: string;
}): string {
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(request.origin);
    requestUrl = new URL(request.url);
  } catch {
    throw new Error("document origin fetch requires absolute https URLs");
  }
  if (originUrl.protocol !== "https:" || requestUrl.protocol !== "https:") {
    throw new Error("document origin fetch requires https");
  }
  if (originUrl.username || originUrl.password) {
    throw new Error("document origin must not include credentials");
  }
  if (!ALLOWED_DOCUMENT_ORIGINS.has(originUrl.origin)) {
    throw new Error(`document origin is not allowed: ${originUrl.origin}`);
  }
  if (requestUrl.origin !== originUrl.origin) {
    throw new Error(
      `document origin fetch url must be same-origin: ${request.url}`
    );
  }
  return originUrl.origin;
}

function sanitizedHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (ALLOWED_HEADER_NAMES.has(key.toLowerCase())) next[key] = value;
  }
  return next;
}

function isAllowedNavigation(origin: string, url: string): boolean {
  if (url === "about:blank") return true;
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw abortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("document origin fetch timed out"));
      }, ms);
      abort = (): void => reject(abortError());
      signal?.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject);
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    if (timer) clearTimeout(timer);
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function attachWindowGuards(win: BrowserWindow, origin: string): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const denyForeign = (event: { preventDefault: () => void }, url: string) => {
    if (!isAllowedNavigation(origin, url)) event.preventDefault();
  };
  win.webContents.on("will-navigate", denyForeign);
  win.webContents.on("will-redirect", denyForeign);
}

function createOriginWindow(origin: string): BrowserWindow {
  const win = new BrowserWindow({
    focusable: false,
    height: 600,
    hiddenInMissionControl: true,
    paintWhenInitiallyHidden: true,
    show: false,
    skipTaskbar: true,
    width: 800,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:pier-document-origin-fetch",
      sandbox: true,
    },
  });
  windows.set(origin, win);
  win.on("closed", () => {
    if (windows.get(origin) === win) windows.delete(origin);
  });
  attachWindowGuards(win, origin);
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  return win;
}

function destroyOriginWindow(origin: string, win: BrowserWindow): void {
  if (windows.get(origin) === win) windows.delete(origin);
  if (!win.isDestroyed()) win.destroy();
}

async function createWindowForOrigin(origin: string): Promise<BrowserWindow> {
  const win = createOriginWindow(origin);
  try {
    await withTimeout(win.loadURL(origin), ORIGIN_FETCH_TIMEOUT_MS);
  } catch (error) {
    destroyOriginWindow(origin, win);
    throw error;
  }
  return win;
}

async function windowForOrigin(
  origin: string,
  signal?: AbortSignal
): Promise<BrowserWindow> {
  const existing = windows.get(origin);
  if (existing && !existing.isDestroyed()) return existing;
  let pending = inflight.get(origin);
  if (!pending) {
    pending = createWindowForOrigin(origin).finally(() => {
      if (inflight.get(origin) === pending) inflight.delete(origin);
    });
    inflight.set(origin, pending);
  }
  return await withTimeout(pending, ORIGIN_FETCH_TIMEOUT_MS, signal);
}

function inPageFetchScript(request: {
  bodyLiteral: string;
  fetchTimeoutMs: number;
  headers: Record<string, string>;
  method: string;
  url: string;
  waitMs: number;
}): string {
  return `(async () => {
      const deadline = Date.now() + ${request.waitMs};
      while (Date.now() < deadline) {
        const title = document.title || "";
        if (
          !/just a moment|attention required/i.test(title) &&
          document.readyState === "complete"
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const res = await fetch(${JSON.stringify(request.url)}, {
        method: ${JSON.stringify(request.method)},
        headers: ${JSON.stringify(request.headers)},
        credentials: "include",
        signal: AbortSignal.timeout(${request.fetchTimeoutMs}),
        body: ${request.bodyLiteral},
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buf.length; i += 1) {
        binary += String.fromCharCode(buf[i] ?? 0);
      }
      return { ok: res.ok, status: res.status, base64: btoa(binary) };
    })()`;
}

function remainingMs(deadlineAt: number): number {
  return Math.max(1, deadlineAt - Date.now());
}

/** Isolated-world fetch after loading `origin` so Cloudflare cookies apply. */
export async function fetchFromDocumentOrigin(
  request: DocumentOriginFetchRequest
): Promise<DocumentOriginFetchResult> {
  const origin = assertDocumentOriginRequest(request);
  if (request.signal?.aborted) throw abortError();
  const deadlineAt = Date.now() + ORIGIN_FETCH_TIMEOUT_MS;
  const originUrl = `${origin}/`;
  const win = await windowForOrigin(originUrl, request.signal);
  if (request.signal?.aborted) throw abortError();
  const method = request.method ?? "GET";
  const headers = sanitizedHeaders(request.headers ?? {});
  const bodyLiteral =
    request.body === undefined
      ? "undefined"
      : `Uint8Array.from(${JSON.stringify([...request.body])})`;
  const budget = remainingMs(deadlineAt);
  const waitMs = Math.min(CF_WAIT_MS, Math.max(0, budget - 500));
  try {
    const result = (await withTimeout(
      win.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
        {
          code: inPageFetchScript({
            bodyLiteral,
            fetchTimeoutMs: budget,
            headers,
            method,
            url: request.url,
            waitMs,
          }),
        },
      ]),
      budget,
      request.signal
    )) as { base64?: unknown; ok?: unknown; status?: unknown };
    if (request.signal?.aborted) throw abortError();
    if (
      typeof result?.base64 !== "string" ||
      typeof result.ok !== "boolean" ||
      typeof result.status !== "number"
    ) {
      throw new Error("document origin fetch returned an invalid result");
    }
    return {
      body: bytesFromBase64(result.base64),
      ok: result.ok,
      status: result.status,
    };
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      destroyOriginWindow(originUrl, win);
    }
    throw error;
  }
}

export function disposeDocumentOriginWindows(): void {
  inflight.clear();
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  windows.clear();
}
