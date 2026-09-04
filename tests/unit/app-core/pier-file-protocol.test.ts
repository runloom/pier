import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  attachPierFileProtocol,
  createPierFileProtocolHost,
  createPierFileProtocolHostForServices,
  PierFileNoWindowError,
  protocolUrlsFromArgv,
} from "../../../src/main/app-core/pier-file-protocol.ts";

describe("createPierFileProtocolHost", () => {
  it("queues pier://file until ready then opens", async () => {
    const openFile = vi.fn(async () => undefined);
    const host = createPierFileProtocolHost({
      logError: vi.fn(),
      openFile,
    });
    await expect(
      host.handle("pier://file/Users/a/repo/docs/a.md#L12")
    ).resolves.toBe(true);
    expect(openFile).not.toHaveBeenCalled();
    await host.markReady();
    expect(openFile).toHaveBeenCalledWith({
      line: 12,
      path: "/Users/a/repo/docs/a.md",
    });
  });

  it("ignores vscode:// and empty urls", async () => {
    const openFile = vi.fn(async () => undefined);
    const host = createPierFileProtocolHost({
      logError: vi.fn(),
      openFile,
    });
    await host.markReady();
    await expect(host.handle("vscode://file/x")).resolves.toBe(false);
    await expect(host.handle("")).resolves.toBe(false);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("requeues when openFile reports no window after ready", async () => {
    const openFile = vi
      .fn()
      .mockRejectedValueOnce(new PierFileNoWindowError())
      .mockResolvedValueOnce(undefined);
    const host = createPierFileProtocolHost({
      logError: vi.fn(),
      openFile,
    });
    await host.markReady();
    await expect(host.handle("pier://file/tmp/a.md")).resolves.toBe(true);
    expect(openFile).toHaveBeenCalledTimes(1);
    await host.markReady();
    expect(openFile).toHaveBeenCalledTimes(2);
    expect(openFile).toHaveBeenLastCalledWith({ path: "/tmp/a.md" });
  });

  it("opens immediately after ready", async () => {
    const openFile = vi.fn(async () => undefined);
    const host = createPierFileProtocolHost({
      logError: vi.fn(),
      openFile,
    });
    await host.markReady();
    await expect(host.handle("pier://file/tmp/notes.md#L4C2")).resolves.toBe(
      true
    );
    expect(openFile).toHaveBeenCalledWith({
      column: 2,
      line: 4,
      path: "/tmp/notes.md",
    });
  });
});

describe("attachPierFileProtocol", () => {
  it("collects pier: argv urls and ignores the rest", () => {
    expect(
      protocolUrlsFromArgv([
        "/usr/bin/electron",
        ".",
        "pier://file/tmp/a.md#L2",
        "--user-data-dir=/tmp",
      ])
    ).toEqual(["pier://file/tmp/a.md#L2"]);
  });

  it("registers the pier scheme and opens argv after ready", async () => {
    const openFile = vi.fn(async () => undefined);
    const host = createPierFileProtocolHost({
      logError: vi.fn(),
      openFile,
    });
    const setAsDefaultProtocolClient = vi.fn(() => true);
    const listeners = new Map<string, (...args: unknown[]) => void>();
    attachPierFileProtocol({
      app: {
        on: (event, listener) => {
          listeners.set(event, listener as (...args: unknown[]) => void);
        },
        setAsDefaultProtocolClient,
      },
      argv: ["electron", "pier://file/tmp/notes.md#L4"],
      defaultApp: false,
      execPath: "/Applications/Pier.app/Contents/MacOS/Pier",
      host,
    });
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith("pier");
    expect(openFile).not.toHaveBeenCalled();
    await host.markReady();
    expect(openFile).toHaveBeenCalledWith({
      line: 4,
      path: "/tmp/notes.md",
    });

    const openUrl = listeners.get("open-url");
    expect(openUrl).toBeTypeOf("function");
    const preventDefault = vi.fn();
    openUrl?.({ preventDefault }, "pier://file/tmp/from-os.md");
    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(openFile).toHaveBeenCalledWith({
        path: "/tmp/from-os.md",
      });
    });
  });

  it("passes the packaged script path when running as defaultApp", () => {
    const host = createPierFileProtocolHost({
      logError: vi.fn(),
      openFile: vi.fn(async () => undefined),
    });
    const setAsDefaultProtocolClient = vi.fn(() => true);
    const script = "/Users/dev/pier/out/main/index.js";
    attachPierFileProtocol({
      app: {
        on: vi.fn(),
        setAsDefaultProtocolClient,
      },
      argv: ["/usr/bin/electron", script],
      defaultApp: true,
      execPath: "/usr/bin/electron",
      host,
    });
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith(
      "pier",
      "/usr/bin/electron",
      [resolve(script)]
    );
  });
});

describe("createPierFileProtocolHostForServices", () => {
  it("dispatches pier://file through the Files open-url chain", async () => {
    const dispatchOpenUrl = vi.fn();
    const host = createPierFileProtocolHostForServices({
      dispatchOpenUrl,
      logError: vi.fn(),
      window: {
        list: () => [
          {
            electronWindowId: "7",
            focused: true,
            id: "main",
            recordId: "rec-1",
          },
        ],
      },
    });
    await host.markReady();
    await expect(
      host.handle("pier://file/Users/a/repo/docs/a.md#L12")
    ).resolves.toBe(true);
    expect(dispatchOpenUrl).toHaveBeenCalledWith({
      url: "pier://file/Users/a/repo/docs/a.md#L12",
      windowElectronId: 7,
    });
  });

  it("requeues pier://file until a window exists", async () => {
    const windows: Array<{
      electronWindowId: string;
      focused: boolean;
      id: string;
      recordId: string;
    }> = [];
    const dispatchOpenUrl = vi.fn();
    const host = createPierFileProtocolHostForServices({
      dispatchOpenUrl,
      logError: vi.fn(),
      window: { list: () => windows },
    });
    await host.markReady();
    await expect(host.handle("pier://file/tmp/a.md")).resolves.toBe(true);
    expect(dispatchOpenUrl).not.toHaveBeenCalled();
    windows.push({
      electronWindowId: "3",
      focused: true,
      id: "main",
      recordId: "r",
    });
    await host.markReady();
    expect(dispatchOpenUrl).toHaveBeenCalledWith({
      url: "pier://file/tmp/a.md",
      windowElectronId: 3,
    });
  });
});
