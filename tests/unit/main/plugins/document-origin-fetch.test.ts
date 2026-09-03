import { beforeEach, describe, expect, it, vi } from "vitest";

const loadURL = vi.fn(async () => undefined);
const executeJavaScriptInIsolatedWorld = vi.fn();
const destroy = vi.fn();
const on = vi.fn();
const webContentsOn = vi.fn();
const isDestroyed = vi.fn(() => false);
const setOpacity = vi.fn();
const setIgnoreMouseEvents = vi.fn();
const showInactive = vi.fn();
const setWindowOpenHandler = vi.fn();
const BrowserWindow = vi.fn(function MockBrowserWindow() {
  return {
    destroy,
    isDestroyed,
    loadURL,
    on,
    setIgnoreMouseEvents,
    setOpacity,
    showInactive,
    webContents: {
      executeJavaScriptInIsolatedWorld,
      on: webContentsOn,
      setWindowOpenHandler,
    },
  };
});

const sessionFetch = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow,
  session: {
    fromPartition: () => ({
      fetch: (...args: unknown[]) => sessionFetch(...args),
    }),
  },
}));

describe("fetchFromDocumentOrigin", () => {
  beforeEach(() => {
    vi.resetModules();
    loadURL.mockReset();
    loadURL.mockResolvedValue(undefined);
    executeJavaScriptInIsolatedWorld.mockReset();
    destroy.mockClear();
    on.mockClear();
    webContentsOn.mockClear();
    isDestroyed.mockReset();
    isDestroyed.mockReturnValue(false);
    setOpacity.mockClear();
    setIgnoreMouseEvents.mockClear();
    showInactive.mockClear();
    setWindowOpenHandler.mockClear();
    BrowserWindow.mockClear();
    sessionFetch.mockReset();
    sessionFetch.mockRejectedValue(new Error("session fetch unavailable"));
  });

  it("uses the Chromium partition session when Cloudflare is already cleared", async () => {
    const payload = Uint8Array.from([1, 2, 3, 4]);
    sessionFetch.mockResolvedValue({
      arrayBuffer: async () =>
        payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength
        ),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? "application/grpc-web+proto"
            : null,
      },
      ok: true,
      status: 200,
    });
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    const result = await fetchFromDocumentOrigin({
      body: new Uint8Array([9]),
      headers: { Accept: "application/grpc-web+proto" },
      method: "POST",
      origin: "https://grok.com/",
      url: "https://grok.com/rpc",
    });
    expect(sessionFetch).toHaveBeenCalledOnce();
    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(result).toEqual({ body: payload, ok: true, status: 200 });
  });

  it("falls back to the hidden window when Cloudflare sets cf-mitigated: challenge", async () => {
    sessionFetch.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: {
        get: (name: string) => {
          const key = name.toLowerCase();
          if (key === "cf-mitigated") {
            return "challenge";
          }
          if (key === "content-type") {
            return "text/html";
          }
          return null;
        },
      },
      ok: false,
      status: 403,
    });
    executeJavaScriptInIsolatedWorld.mockResolvedValue({
      base64: Buffer.from("ok").toString("base64"),
      ok: true,
      status: 200,
    });
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    await fetchFromDocumentOrigin({
      origin: "https://grok.com/",
      url: "https://grok.com/rpc",
    });
    expect(BrowserWindow).toHaveBeenCalledOnce();
  });

  it("does not treat a non-challenge HTML error as a Cloudflare wall", async () => {
    const html = new TextEncoder().encode("<html>upstream 500</html>");
    sessionFetch.mockResolvedValue({
      arrayBuffer: async () =>
        html.buffer.slice(html.byteOffset, html.byteOffset + html.byteLength),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      ok: false,
      status: 500,
    });
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    const result = await fetchFromDocumentOrigin({
      origin: "https://grok.com/",
      url: "https://grok.com/rpc",
    });
    expect(BrowserWindow).not.toHaveBeenCalled();
    expect(result.status).toBe(500);
    expect(result.ok).toBe(false);
  });

  it("does not open the hidden window when the session hop is aborted", async () => {
    sessionFetch.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const fail = (): void => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail, { once: true });
        })
    );
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    const controller = new AbortController();
    const pending = fetchFromDocumentOrigin({
      origin: "https://grok.com/",
      signal: controller.signal,
      url: "https://grok.com/rpc",
    });
    await vi.waitFor(() => {
      expect(sessionFetch).toHaveBeenCalled();
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("times out a hung session hop without opening the hidden window", async () => {
    vi.useFakeTimers();
    try {
      sessionFetch.mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            const fail = (): void => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            };
            if (signal?.aborted) {
              fail();
              return;
            }
            signal?.addEventListener("abort", fail, { once: true });
          })
      );
      const { ORIGIN_FETCH_TIMEOUT_MS, fetchFromDocumentOrigin } = await import(
        "@main/plugins/document-origin-fetch.ts"
      );
      const pending = fetchFromDocumentOrigin({
        origin: "https://grok.com/",
        url: "https://grok.com/rpc",
      });
      const rejection = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(ORIGIN_FETCH_TIMEOUT_MS);
      await rejection;
      expect(BrowserWindow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads origin then returns isolated-world fetch body as base64 bytes", async () => {
    const payload = Uint8Array.from([0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    executeJavaScriptInIsolatedWorld.mockResolvedValue({
      base64: Buffer.from(payload).toString("base64"),
      ok: true,
      status: 200,
    });
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );

    const result = await fetchFromDocumentOrigin({
      body: new Uint8Array([0, 0, 0, 0, 0]),
      headers: {
        Accept: "application/grpc-web+proto",
        Cookie: "steal-me",
      },
      method: "POST",
      origin: "https://grok.com/",
      url: "https://grok.com/rpc",
    });

    expect(loadURL).toHaveBeenCalledWith("https://grok.com/");
    expect(showInactive).toHaveBeenCalledOnce();
    expect(setWindowOpenHandler).toHaveBeenCalledOnce();
    expect(setWindowOpenHandler.mock.calls[0]?.[0]?.()).toEqual({
      action: "deny",
    });
    expect(webContentsOn).toHaveBeenCalledWith(
      "will-navigate",
      expect.any(Function)
    );
    expect(webContentsOn).toHaveBeenCalledWith(
      "will-redirect",
      expect.any(Function)
    );
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
    const worldId = executeJavaScriptInIsolatedWorld.mock.calls[0]?.[0];
    const scripts = executeJavaScriptInIsolatedWorld.mock.calls[0]?.[1] as
      | Array<{ code: string }>
      | undefined;
    expect(worldId).toBe(1000);
    const script = scripts?.[0]?.code ?? "";
    expect(script).toContain("https://grok.com/rpc");
    expect(script).toContain("application/grpc-web+proto");
    expect(script).not.toContain("steal-me");
    expect(script).toContain("btoa");
    expect(script).toContain('credentials: "include"');
    expect(script).toContain("AbortSignal.timeout");
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        hiddenInMissionControl: true,
        show: false,
        skipTaskbar: true,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          partition: "persist:pier-document-origin-fetch",
          sandbox: true,
        }),
      })
    );
    expect(result).toEqual({
      body: payload,
      ok: true,
      status: 200,
    });
  });

  it("reuses one window while a second caller is still loading origin", async () => {
    let releaseLoad: (() => void) | undefined;
    loadURL.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseLoad = () => resolve(undefined);
        })
    );
    executeJavaScriptInIsolatedWorld.mockResolvedValue({
      base64: Buffer.from("ok").toString("base64"),
      ok: true,
      status: 200,
    });
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    const request = {
      origin: "https://grok.com/",
      url: "https://grok.com/rpc",
    };
    const first = fetchFromDocumentOrigin(request);
    const second = fetchFromDocumentOrigin(request);
    await vi.waitFor(() => {
      expect(BrowserWindow).toHaveBeenCalledOnce();
    });
    releaseLoad?.();
    await Promise.all([first, second]);
    expect(BrowserWindow).toHaveBeenCalledOnce();
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2);
  });

  it("rejects origins outside the host allowlist", async () => {
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    await expect(
      fetchFromDocumentOrigin({
        origin: "https://chatgpt.com/",
        url: "https://chatgpt.com/backend-api/x",
      })
    ).rejects.toThrow(/not allowed/);
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("rejects a url that is not same-origin with origin", async () => {
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    await expect(
      fetchFromDocumentOrigin({
        origin: "https://grok.com/",
        url: "https://cli-chat-proxy.grok.com/v1/billing",
      })
    ).rejects.toThrow(/same-origin/);
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("rejects an already aborted signal before opening a window", async () => {
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchFromDocumentOrigin({
        origin: "https://grok.com/",
        signal: controller.signal,
        url: "https://grok.com/rpc",
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("destroys the window when origin navigation fails", async () => {
    loadURL.mockRejectedValueOnce(new Error("net::ERR_FAILED"));
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );

    await expect(
      fetchFromDocumentOrigin({
        origin: "https://grok.com/",
        url: "https://grok.com/rpc",
      })
    ).rejects.toThrow("net::ERR_FAILED");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the helper window when isolated-world fetch fails", async () => {
    executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error("boom"));
    const { fetchFromDocumentOrigin } = await import(
      "@main/plugins/document-origin-fetch.ts"
    );
    await expect(
      fetchFromDocumentOrigin({
        origin: "https://grok.com/",
        url: "https://grok.com/rpc",
      })
    ).rejects.toThrow("boom");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("dispose destroys cached origin windows", async () => {
    executeJavaScriptInIsolatedWorld.mockResolvedValue({
      base64: Buffer.from("ok").toString("base64"),
      ok: true,
      status: 200,
    });
    const { disposeDocumentOriginWindows, fetchFromDocumentOrigin } =
      await import("@main/plugins/document-origin-fetch.ts");

    await fetchFromDocumentOrigin({
      origin: "https://grok.com/",
      url: "https://grok.com/rpc",
    });
    expect(destroy).not.toHaveBeenCalled();
    disposeDocumentOriginWindows();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("tears down an idle origin window and recreates it on the next fetch", async () => {
    vi.useFakeTimers();
    try {
      executeJavaScriptInIsolatedWorld.mockResolvedValue({
        base64: Buffer.from("ok").toString("base64"),
        ok: true,
        status: 200,
      });
      const { fetchFromDocumentOrigin } = await import(
        "@main/plugins/document-origin-fetch.ts"
      );
      const request = {
        origin: "https://grok.com/",
        url: "https://grok.com/rpc",
      };

      await fetchFromDocumentOrigin(request);
      expect(BrowserWindow).toHaveBeenCalledOnce();
      expect(destroy).not.toHaveBeenCalled();

      // 下一轮轮询前（15 分钟节奏）就应释放整站 SPA 进程。
      await vi.advanceTimersByTimeAsync(60_000);
      expect(destroy).toHaveBeenCalledOnce();

      await fetchFromDocumentOrigin(request);
      expect(BrowserWindow).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the idle clock when a later fetch reuses the window", async () => {
    vi.useFakeTimers();
    try {
      executeJavaScriptInIsolatedWorld.mockResolvedValue({
        base64: Buffer.from("ok").toString("base64"),
        ok: true,
        status: 200,
      });
      const { fetchFromDocumentOrigin } = await import(
        "@main/plugins/document-origin-fetch.ts"
      );
      const request = {
        origin: "https://grok.com/",
        url: "https://grok.com/rpc",
      };

      await fetchFromDocumentOrigin(request);
      await vi.advanceTimersByTimeAsync(30_000);
      await fetchFromDocumentOrigin(request);
      expect(BrowserWindow).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(destroy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
