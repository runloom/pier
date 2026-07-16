import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

function leaseFrom(value: unknown): { gitRoot: string; leaseId: string } {
  expect(value).toEqual({
    gitRoot: expect.any(String),
    leaseId: expect.any(String),
  });
  return value as { gitRoot: string; leaseId: string };
}

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        electronMock.handlers.set(channel, handler);
      }
    ),
  },
}));
const disposeWatch = vi.hoisted(() => vi.fn());
const watch = vi.hoisted(() => vi.fn(() => disposeWatch));
const resolveCanonicalGitWatchRoot = vi.hoisted(() =>
  vi.fn(async (root: unknown) => (typeof root === "string" ? root : null))
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock("electron", () => ({ ipcMain: electronMock.ipcMain }));
vi.mock("@main/ipc/git-watch-root.ts", () => ({
  resolveCanonicalGitWatchRoot,
}));
vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    clients: {
      heartbeat: vi.fn(() => ({ capabilities: ["git:read"] })),
      register: vi.fn(),
    },
    services: { gitWatch: { watch } },
  },
}));
vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "main"),
    fromWebContents: vi.fn(() => ({ id: 1 })),
  },
}));

describe("registerGitWatchIpc", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    disposeWatch.mockClear();
    watch.mockClear();
    resolveCanonicalGitWatchRoot.mockClear();
    resolveCanonicalGitWatchRoot.mockImplementation(async (root: unknown) =>
      typeof root === "string" ? root : null
    );
  });

  it("renderer 崩溃时释放全部 watcher，重复生命周期事件保持幂等", async () => {
    const listeners = new Map<string, () => void>();
    const onceListeners = new Map<string, () => void>();
    const mainFrame = {};
    const sender = {
      id: 42,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      once: vi.fn((event: string, listener: () => void) => {
        onceListeners.set(event, listener);
      }),
      send: vi.fn(),
    };
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    if (!start) {
      throw new Error("missing git watch start handler");
    }

    leaseFrom(await start({ sender, senderFrame: mainFrame }, "/repo"));
    expect(watch).toHaveBeenCalledOnce();
    listeners.get("render-process-gone")?.();
    listeners.get("did-navigate")?.();
    onceListeners.get("destroyed")?.();

    expect(disposeWatch).toHaveBeenCalledOnce();
  });

  it("导航后新文档不会复用旧文档已取消的同根解析", async () => {
    const listeners = new Map<string, () => void>();
    const mainFrame = {};
    const sender = {
      id: 46,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      once: vi.fn(),
      send: vi.fn(),
    };
    const oldRawOperation = deferred<void>();
    const sharedResolution = deferred<string | null>();
    resolveCanonicalGitWatchRoot.mockImplementationOnce(
      async (
        _root: unknown,
        _signal?: AbortSignal,
        trackRawOperation?: (operation: Promise<void>) => void
      ) => {
        trackRawOperation?.(oldRawOperation.promise);
        return await sharedResolution.promise;
      }
    );
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    if (!start) {
      throw new Error("missing git watch start handler");
    }
    const event = { sender, senderFrame: mainFrame };

    const oldStart = start(event, "/repo");
    await vi.waitFor(() =>
      expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledOnce()
    );
    listeners.get("did-navigate")?.();
    await expect(oldStart).resolves.toBe(false);

    const newStart = start(event, "/repo");
    sharedResolution.resolve("/repo");
    const newLease = leaseFrom(await newStart);
    expect(newLease.gitRoot).toBe("/repo");
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledOnce();
    expect(watch).toHaveBeenCalledOnce();
    oldRawOperation.resolve();
  });

  it("连续导航复用同根底层探测且不会耗尽其它窗口的全局槽", async () => {
    const listeners = new Map<string, () => void>();
    const mainFrame = {};
    const sender = {
      id: 47,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      once: vi.fn(),
      send: vi.fn(),
    };
    const otherMainFrame = {};
    const otherSender = {
      id: 48,
      isDestroyed: vi.fn(() => false),
      mainFrame: otherMainFrame,
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
    };
    const stalledRaw = deferred<void>();
    resolveCanonicalGitWatchRoot.mockImplementation(
      async (
        root: unknown,
        _signal?: AbortSignal,
        trackRawOperation?: (operation: Promise<void>) => void
      ) => {
        if (root === "/stalled") {
          trackRawOperation?.(stalledRaw.promise);
          return null;
        }
        return typeof root === "string" ? root : null;
      }
    );
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    if (!start) {
      throw new Error("missing git watch start handler");
    }
    const event = { sender, senderFrame: mainFrame };

    for (let index = 0; index < 64; index += 1) {
      await expect(start(event, "/stalled")).resolves.toBe(false);
      listeners.get("did-navigate")?.();
    }
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledOnce();
    leaseFrom(
      await start(
        { sender: otherSender, senderFrame: otherMainFrame },
        "/healthy"
      )
    );
    stalledRaw.resolve();
  });

  it("子 frame 与空 senderFrame 不能启动或停止主 frame 的订阅", async () => {
    const mainFrame = {};
    const sender = {
      id: 43,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
    };
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    const stop = electronMock.handlers.get(PIER.GIT_WATCH_STOP);
    if (!(start && stop)) {
      throw new Error("missing git watch handlers");
    }

    await expect(start({ sender, senderFrame: {} }, "/repo")).resolves.toBe(
      false
    );
    await expect(start({ sender, senderFrame: null }, "/repo")).resolves.toBe(
      false
    );
    expect(stop({ sender, senderFrame: {} }, "/repo")).toBe(false);
    expect(stop({ sender, senderFrame: null }, "/repo")).toBe(false);
    expect(resolveCanonicalGitWatchRoot).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(disposeWatch).not.toHaveBeenCalled();
  });

  it("按 canonical root 去重别名并在每窗口根上限前拒绝副作用", async () => {
    const mainFrame = {};
    const sender = {
      id: 44,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
    };
    resolveCanonicalGitWatchRoot.mockImplementation(async (root: unknown) => {
      if (root === "/alias") {
        return "/repo";
      }
      return typeof root === "string" ? root : null;
    });
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    const stop = electronMock.handlers.get(PIER.GIT_WATCH_STOP);
    if (!(start && stop)) {
      throw new Error("missing git watch handlers");
    }
    const event = { sender, senderFrame: mainFrame };

    const directLease = leaseFrom(await start(event, "/repo"));
    const aliasLease = leaseFrom(await start(event, "/alias"));
    expect(aliasLease.gitRoot).toBe("/repo");
    expect(watch).toHaveBeenCalledOnce();
    resolveCanonicalGitWatchRoot.mockRejectedValue(
      new Error("repository moved")
    );
    expect(stop(event, { leaseId: aliasLease.leaseId })).toBe(true);
    expect(disposeWatch).not.toHaveBeenCalled();
    expect(stop(event, { leaseId: directLease.leaseId })).toBe(true);
    expect(disposeWatch).toHaveBeenCalledOnce();
    expect(stop(event, { leaseId: directLease.leaseId })).toBe(false);
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledTimes(2);

    resolveCanonicalGitWatchRoot.mockImplementation(async (root: unknown) =>
      typeof root === "string" ? root : null
    );

    for (let index = 0; index < 16; index += 1) {
      leaseFrom(await start(event, `/repo-${index}`));
    }
    await expect(start(event, "/over-cap")).resolves.toBe(false);
    expect(watch).toHaveBeenCalledTimes(17);
  });

  it("共享同一原始根的完整解析，并在昂贵解析前限制全局在飞数量", async () => {
    const lifecycle = new Map<number, Map<string, () => void>>();
    const senders = Array.from({ length: 5 }, (_, index) => {
      const listeners = new Map<string, () => void>();
      lifecycle.set(index + 100, listeners);
      const mainFrame = {};
      return {
        event: {
          sender: {
            id: index + 100,
            isDestroyed: vi.fn(() => false),
            mainFrame,
            on: vi.fn((name: string, listener: () => void) => {
              listeners.set(name, listener);
            }),
            once: vi.fn(),
            send: vi.fn(),
          },
          senderFrame: mainFrame,
        },
      };
    });
    resolveCanonicalGitWatchRoot.mockImplementation(
      async (root: unknown, signal?: AbortSignal) =>
        new Promise<string | null>((resolve) => {
          signal?.addEventListener("abort", () => resolve(null), {
            once: true,
          });
          if (root === "/shared") {
            queueMicrotask(() => resolve("/shared"));
          }
        })
    );
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    if (!start) {
      throw new Error("missing git watch start handler");
    }

    const shared = Array.from({ length: 40 }, () =>
      start(senders[0]?.event, "/shared")
    );
    const sharedResults = await Promise.all(shared);
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledOnce();
    expect(sharedResults.filter((value) => value !== false)).toHaveLength(32);

    resolveCanonicalGitWatchRoot.mockClear();
    const pending = senders.flatMap(({ event }, senderIndex) =>
      Array.from({ length: 16 }, (_, rootIndex) =>
        start(event, `/pending-${senderIndex}-${rootIndex}`)
      )
    );
    await Promise.resolve();
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledTimes(64);
    for (const listeners of lifecycle.values()) {
      listeners.get("did-navigate")?.();
    }
    await expect(Promise.all(pending)).resolves.toEqual(
      expect.arrayContaining(Array.from({ length: 80 }, () => false))
    );
  });

  it("调用方提前返回后仍按底层路径操作结算释放全局解析槽位", async () => {
    const senders = Array.from({ length: 5 }, (_, index) => {
      const mainFrame = {};
      return {
        sender: {
          id: index + 200,
          isDestroyed: vi.fn(() => false),
          mainFrame,
          on: vi.fn(),
          once: vi.fn(),
          send: vi.fn(),
        },
        senderFrame: mainFrame,
      };
    });
    const rawOperations = Array.from({ length: 65 }, () => deferred<void>());
    let resolutionIndex = 0;
    resolveCanonicalGitWatchRoot.mockImplementation(
      async (
        _root: unknown,
        _signal?: AbortSignal,
        trackRawOperation?: (operation: Promise<void>) => void
      ) => {
        const operation = rawOperations[resolutionIndex];
        resolutionIndex += 1;
        if (operation) {
          trackRawOperation?.(operation.promise);
        }
        return null;
      }
    );
    const { registerGitWatchIpc } = await import("@main/ipc/git-watch.ts");
    registerGitWatchIpc();
    const start = electronMock.handlers.get(PIER.GIT_WATCH_START);
    if (!start) {
      throw new Error("missing git watch start handler");
    }

    const firstWave = senders
      .slice(0, 4)
      .flatMap((event, senderIndex) =>
        Array.from({ length: 16 }, (_, rootIndex) =>
          start(event, `/raw-${senderIndex}-${rootIndex}`)
        )
      );
    await expect(Promise.all(firstWave)).resolves.toEqual(
      Array.from({ length: 64 }, () => false)
    );
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledTimes(64);

    await expect(start(senders[4], "/held-cap")).resolves.toBe(false);
    expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledTimes(64);

    rawOperations[0]?.resolve();
    await vi.waitFor(async () => {
      await start(senders[4], "/released-cap");
      expect(resolveCanonicalGitWatchRoot).toHaveBeenCalledTimes(65);
    });
  });
});
