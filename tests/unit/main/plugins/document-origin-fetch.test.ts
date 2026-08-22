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

vi.mock("electron", () => ({
  BrowserWindow,
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
});
