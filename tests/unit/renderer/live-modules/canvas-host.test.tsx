// @vitest-environment jsdom

import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { host, useHostSnapshot } from "@/lib/live-modules/host.ts";
import * as resourceStore from "@/stores/pier-resource.store.ts";

describe("canvas host runtime", () => {
  const originalPier = window.pier;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.pier = originalPier;
  });

  it("denies writes before IPC", async () => {
    await expect(
      host.invoke({
        contents: "x",
        path: "notes.md",
        root: "/tmp",
        type: "file.writeText",
      })
    ).rejects.toThrow(/canvas host denies file.writeText/);
  });

  it("inspects the allowlist without a preload bridge", () => {
    const inspected = host.inspect();
    expect(inspected.commands).toContain("file.list");
    expect(inspected.channels).toContain("pier://git:changed");
    expect(inspected.snapshots).toEqual([
      "foreground-activity",
      "resources",
      "usage-data",
    ]);
    const file = inspected.domains.find((domain) => domain.id === "file");
    const list = file?.commands.find((command) => command.type === "file.list");
    expect(list?.fields.map((field) => field.name).sort()).toEqual([
      "path",
      "root",
    ]);
    expect(list?.fields.every((field) => field.optional === false)).toBe(true);
    expect(file?.exemplar).toBe("file.list");
  });

  it("returns an empty ready snapshot when the host bridge is missing", () => {
    const { result } = renderHook(() => useHostSnapshot("foreground-activity"));
    expect(result.current).toEqual({
      data: null,
      error: null,
      status: "ready",
    });
  });

  it("loads a snapshot id and subscribes to its live channel", () => {
    const snapshot = vi.fn(async () => ({ activities: [], ts: 1 }));
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke: vi.fn(),
        snapshot,
        subscribe,
      },
    } as unknown as typeof window.pier;
    const { unmount } = renderHook(() =>
      useHostSnapshot("foreground-activity")
    );
    expect(snapshot).toHaveBeenCalledWith("foreground-activity");
    expect(subscribe).toHaveBeenCalledWith(
      "pier://foreground-activity:changed",
      expect.any(Function)
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("starts and stops resource polling while the snapshot hook is mounted", () => {
    const release = vi.fn();
    const acquire = vi
      .spyOn(resourceStore, "acquirePierResourcePolling")
      .mockReturnValue(release);
    const { unmount } = renderHook(() => useHostSnapshot("resources"));
    expect(acquire).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("returns an empty ready snapshot for plugin targets without a bridge", () => {
    const { result } = renderHook(() =>
      useHostSnapshot("plugin:pier.codex/accounts.usage")
    );
    expect(result.current).toEqual({
      data: null,
      error: null,
      status: "ready",
    });
  });

  it("loads a plugin watch target via command and filters changed events", async () => {
    const invoke = vi.fn(async () => ({ used: 1 }));
    let listener: ((event: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (_channel: string, fn: (event: unknown) => void) => {
        listener = fn;
        return unsubscribe;
      }
    );
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke,
        snapshot: vi.fn(),
        subscribe,
      },
    } as unknown as typeof window.pier;

    const { result, unmount } = renderHook(() =>
      useHostSnapshot("plugin:pier.codex/accounts.usage")
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        data: { used: 1 },
        error: null,
        status: "ready",
      })
    );
    expect(invoke).toHaveBeenCalledWith({
      type: "pluginData.snapshot",
      payload: { key: "accounts.usage", pluginId: "pier.codex" },
    });
    expect(invoke).toHaveBeenCalledWith({
      type: "pluginData.watchStart",
      payload: { key: "accounts.usage", pluginId: "pier.codex" },
    });
    expect(subscribe).toHaveBeenCalledWith(
      PIER_BROADCAST.PLUGIN_DATA_CHANGED,
      expect.any(Function)
    );

    // 扁平对象形状：剥掉信封字段后剩余属性即数据。
    act(() => {
      listener?.({ key: "accounts.usage", pluginId: "pier.codex", v: 7 });
    });
    expect(result.current).toEqual({
      data: { v: 7 },
      error: null,
      status: "ready",
    });

    // 包装形状：非对象 payload 存于 payload 键。
    act(() => {
      listener?.({
        key: "accounts.usage",
        payload: [1, 2],
        pluginId: "pier.codex",
      });
    });
    expect(result.current.data).toEqual([1, 2]);

    // key 不匹配的事件不改变 state。
    act(() => {
      listener?.({ key: "other.key", payload: "nope", pluginId: "pier.codex" });
    });
    expect(result.current.data).toEqual([1, 2]);
    act(() => {
      listener?.({ key: "accounts.usage", payload: "nope", pluginId: "other" });
    });
    expect(result.current.data).toEqual([1, 2]);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith({
      type: "pluginData.watchStop",
      payload: { key: "accounts.usage", pluginId: "pier.codex" },
    });
  });

  it("keeps a live push when the initial snapshot resolves later (canonical)", async () => {
    let resolveSnapshot: ((value: unknown) => void) | undefined;
    const snapshot = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        })
    );
    let listener: ((payload: unknown) => void) | undefined;
    const subscribe = vi.fn(
      (_channel: string, fn: (payload: unknown) => void) => {
        listener = fn;
        return () => undefined;
      }
    );
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke: vi.fn(),
        snapshot,
        subscribe,
      },
    } as unknown as typeof window.pier;

    const { result } = renderHook(() => useHostSnapshot("foreground-activity"));
    act(() => {
      listener?.({ activities: ["fresh"], ts: 2 });
    });
    expect(result.current.data).toEqual({ activities: ["fresh"], ts: 2 });

    // The stale pull resolves after the broadcast: it must not win.
    await act(async () => {
      resolveSnapshot?.({ activities: [], ts: 1 });
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      data: { activities: ["fresh"], ts: 2 },
      error: null,
      status: "ready",
    });
  });

  it("ignores a late snapshot failure once a push landed (canonical)", async () => {
    let rejectSnapshot: ((error: unknown) => void) | undefined;
    const snapshot = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectSnapshot = reject;
        })
    );
    let listener: ((payload: unknown) => void) | undefined;
    const subscribe = vi.fn(
      (_channel: string, fn: (payload: unknown) => void) => {
        listener = fn;
        return () => undefined;
      }
    );
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke: vi.fn(),
        snapshot,
        subscribe,
      },
    } as unknown as typeof window.pier;

    const { result } = renderHook(() => useHostSnapshot("foreground-activity"));
    act(() => {
      listener?.({ ts: 2 });
    });
    await act(async () => {
      rejectSnapshot?.(new Error("boom"));
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      data: { ts: 2 },
      error: null,
      status: "ready",
    });
  });

  it("keeps a live plugin push when the projection snapshot resolves later", async () => {
    let resolveSnapshot: ((value: unknown) => void) | undefined;
    const invoke = vi.fn((command: { type: string }) => {
      if (command.type === "pluginData.snapshot") {
        return new Promise((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    let listener: ((event: unknown) => void) | undefined;
    const subscribe = vi.fn(
      (_channel: string, fn: (event: unknown) => void) => {
        listener = fn;
        return () => undefined;
      }
    );
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke,
        snapshot: vi.fn(),
        subscribe,
      },
    } as unknown as typeof window.pier;

    const { result } = renderHook(() =>
      useHostSnapshot("plugin:pier.codex/accounts.usage")
    );
    act(() => {
      listener?.({
        key: "accounts.usage",
        payload: "fresh",
        pluginId: "pier.codex",
      });
    });
    expect(result.current.data).toBe("fresh");

    await act(async () => {
      resolveSnapshot?.({ used: 1 });
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      data: "fresh",
      error: null,
      status: "ready",
    });
  });

  it("ignores a late plugin snapshot failure once a push landed", async () => {
    let rejectSnapshot: ((error: unknown) => void) | undefined;
    const invoke = vi.fn((command: { type: string }) => {
      if (command.type === "pluginData.snapshot") {
        return new Promise((_resolve, reject) => {
          rejectSnapshot = reject;
        });
      }
      return Promise.resolve(undefined);
    });
    let listener: ((event: unknown) => void) | undefined;
    const subscribe = vi.fn(
      (_channel: string, fn: (event: unknown) => void) => {
        listener = fn;
        return () => undefined;
      }
    );
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke,
        snapshot: vi.fn(),
        subscribe,
      },
    } as unknown as typeof window.pier;

    const { result } = renderHook(() =>
      useHostSnapshot("plugin:pier.codex/accounts.usage")
    );
    act(() => {
      listener?.({
        key: "accounts.usage",
        payload: "fresh",
        pluginId: "pier.codex",
      });
    });
    await act(async () => {
      rejectSnapshot?.(new Error("projection not declared"));
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      data: "fresh",
      error: null,
      status: "ready",
    });
  });

  it("propagates plugin snapshot command failures to the error state", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("projection not declared");
    });
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke,
        snapshot: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
    } as unknown as typeof window.pier;
    const { result } = renderHook(() =>
      useHostSnapshot("plugin:pier.codex/accounts.usage")
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        data: null,
        error: "projection not declared",
        status: "error",
      })
    );
  });
});
