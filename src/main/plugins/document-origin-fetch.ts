import type {
  DocumentOriginFetchRequest,
  DocumentOriginFetchResult,
} from "@pier/plugin-api/main";
import { BrowserWindow, session } from "electron";

export type {
  DocumentOriginFetchRequest,
  DocumentOriginFetchResult,
} from "@pier/plugin-api/main";

export const ORIGIN_FETCH_TIMEOUT_MS = 8000;
const CF_WAIT_MS = 3000;
const ISOLATED_WORLD_ID = 1000;
/** Shared with the hidden-window fallback so `cf_clearance` survives idle teardown. */
const DOCUMENT_ORIGIN_PARTITION = "persist:pier-document-origin-fetch";
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
/** Idle teardown: grok.com SPA is a whole renderer; poll interval is 15 min. */
const ORIGIN_WINDOW_IDLE_TTL_MS = 60_000;
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeFetches = new Map<string, number>();

function cancelIdleTeardown(origin: string): void {
  const timer = idleTimers.get(origin);
  if (timer === undefined) return;
  clearTimeout(timer);
  idleTimers.delete(origin);
}

function scheduleIdleTeardown(origin: string): void {
  cancelIdleTeardown(origin);
  const timer = setTimeout(() => {
    idleTimers.delete(origin);
    if ((activeFetches.get(origin) ?? 0) > 0) return;
    const win = windows.get(origin);
    if (win) destroyOriginWindow(origin, win);
  }, ORIGIN_WINDOW_IDLE_TTL_MS);
  timer.unref?.();
  idleTimers.set(origin, timer);
}

function beginFetch(origin: string): void {
  cancelIdleTeardown(origin);
  activeFetches.set(origin, (activeFetches.get(origin) ?? 0) + 1);
}

function endFetch(origin: string): void {
  const remaining = (activeFetches.get(origin) ?? 1) - 1;
  if (remaining > 0) {
    activeFetches.set(origin, remaining);
    return;
  }
  activeFetches.delete(origin);
  if (windows.has(origin)) scheduleIdleTeardown(origin);
}

function abortError(): Error {
  const error = new Error("document origin fetch aborted");
  error.name = "AbortError";
  return error;
}

function timeoutError(): Error {
  const error = new Error("document origin fetch timed out");
  error.name = "TimeoutError";
  return error;
}

function isAbortOrTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
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
        reject(timeoutError());
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

/** Cloudflare Challenge Pages set `cf-mitigated: challenge` on every type. */
function looksLikeCloudflareChallenge(response: {
  headers: { get(name: string): string | null };
}): boolean {
  return response.headers.get("cf-mitigated") === "challenge";
}

/**
 * Chromium-stack fetch on the origin partition (cookies, TLS fingerprint).
 * Returns null only for a CF challenge or a retryable network failure — never
 * for abort/timeout (those must not boot the hidden window).
 */
async function fetchViaChromiumSession(
  request: DocumentOriginFetchRequest
): Promise<DocumentOriginFetchResult | null> {
  if (request.signal?.aborted) {
    throw abortError();
  }
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  request.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ORIGIN_FETCH_TIMEOUT_MS);
  timer.unref?.();
  try {
    const ses = session.fromPartition(DOCUMENT_ORIGIN_PARTITION);
    const init: RequestInit = {
      headers: sanitizedHeaders(request.headers ?? {}),
      method: request.method ?? "GET",
      signal: controller.signal,
    };
    if (request.body) {
      init.body = Buffer.from(request.body);
    }
    const response = await ses.fetch(request.url, init);
    if (looksLikeCloudflareChallenge(response)) {
      return null;
    }
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    if (request.signal?.aborted) {
      throw abortError();
    }
    if (timedOut) {
      throw timeoutError();
    }
    if (isAbortOrTimeoutError(error)) {
      throw abortError();
    }
    return null;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
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
      partition: DOCUMENT_ORIGIN_PARTITION,
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
  cancelIdleTeardown(origin);
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
  const originUrl = `${origin}/`;
  beginFetch(originUrl);
  try {
    const viaSession = await fetchViaChromiumSession(request);
    if (viaSession) {
      return viaSession;
    }
    return await fetchWithOriginWindow(originUrl, request);
  } finally {
    endFetch(originUrl);
  }
}

async function fetchWithOriginWindow(
  originUrl: string,
  request: DocumentOriginFetchRequest
): Promise<DocumentOriginFetchResult> {
  const deadlineAt = Date.now() + ORIGIN_FETCH_TIMEOUT_MS;
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
  for (const origin of idleTimers.keys()) {
    cancelIdleTeardown(origin);
  }
  activeFetches.clear();
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  windows.clear();
}
