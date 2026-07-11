import { subscribeFileWatch } from "@preload/file-watch-subscription.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("file watch preload subscription", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries transient start failures until the main watch accepts", async () => {
    vi.useFakeTimers();
    const invoke = vi
      .fn()
      .mockResolvedValue(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("main starting"))
      .mockResolvedValueOnce(true);
    const ipcRenderer = { invoke, off: vi.fn(), on: vi.fn() };
    const dispose = subscribeFileWatch({
      ipcRenderer: ipcRenderer as never,
      listener: vi.fn(),
      root: "/repo/",
    });
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);

    expect(invoke).toHaveBeenNthCalledWith(
      3,
      "pier://file:watch-start",
      "/repo/"
    );

    dispose();
    await Promise.resolve();
    expect(invoke).toHaveBeenLastCalledWith("pier://file:watch-stop", "/repo/");
  });

  it("stops a watch that finishes starting after disposal", async () => {
    const start = deferred<unknown>();
    const invoke = vi.fn().mockReturnValueOnce(start.promise);
    const ipcRenderer = { invoke, off: vi.fn(), on: vi.fn() };
    const dispose = subscribeFileWatch({
      ipcRenderer: ipcRenderer as never,
      listener: vi.fn(),
      root: "/repo",
    });

    dispose();
    start.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).toHaveBeenLastCalledWith("pier://file:watch-stop", "/repo");
  });

  it("forwards only events for the normalized subscribed root", () => {
    const subscription: {
      handler?: (event: unknown, payload: FileWatchEvent) => void;
    } = {};
    const listener = vi.fn();
    const ipcRenderer = {
      invoke: vi.fn(async () => true),
      off: vi.fn(),
      on: vi.fn((_channel, candidate) => {
        subscription.handler = candidate;
      }),
    };
    subscribeFileWatch({
      ipcRenderer: ipcRenderer as never,
      listener,
      root: "/repo/",
    });

    subscription.handler?.({}, { changes: [], root: "/repo" });
    subscription.handler?.({}, { changes: [], root: "/other" });

    expect(listener).toHaveBeenCalledOnce();
  });
});
