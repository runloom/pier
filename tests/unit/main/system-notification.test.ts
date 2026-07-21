import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const show = vi.fn();
  const close = vi.fn();
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const isSupported = vi.fn(() => true);
  let autoEmitShow = true;
  let lastOptions: Record<string, unknown> | undefined;

  class MockNotification {
    static isSupported = isSupported;
    constructor(options: Record<string, unknown> = {}) {
      lastOptions = options;
    }
    show = () => {
      show();
      if (autoEmitShow) {
        for (const cb of handlers.get("show") ?? []) {
          cb();
        }
      }
    };
    close = close;
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        const list = handlers.get(event) ?? [];
        const idx = list.indexOf(wrapped);
        if (idx >= 0) {
          list.splice(idx, 1);
        }
        cb(...args);
      };
      return this.on(event, wrapped);
    }
  }

  return {
    MockNotification,
    close,
    get lastOptions() {
      return lastOptions;
    },
    handlers,
    isSupported,
    openExternal: vi.fn(async () => undefined),
    resetLastOptions() {
      lastOptions = undefined;
    },
    setAutoEmitShow(value: boolean) {
      autoEmitShow = value;
    },
    show,
  };
});

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      callback(null, "", "");
      return {} as unknown;
    }
  ),
}));

vi.mock("electron", () => ({
  Notification: electronMock.MockNotification,
  app: {
    focus: vi.fn(),
    hide: vi.fn(),
    isPackaged: true,
  },
  shell: {
    openExternal: electronMock.openExternal,
  },
}));

vi.mock("node:child_process", () => ({
  default: { execFile: childProcessMock.execFile },
  execFile: childProcessMock.execFile,
}));

import {
  getSystemNotificationPermissionSnapshot,
  openSystemNotificationSettings,
  resetSystemNotificationPermissionStateForTests,
  showSystemNotification,
  showTestSystemNotification,
} from "@main/services/system-notification.ts";

describe("system notification permission probe", () => {
  beforeEach(() => {
    resetSystemNotificationPermissionStateForTests();
    electronMock.handlers.clear();
    electronMock.show.mockClear();
    electronMock.close.mockClear();
    electronMock.openExternal.mockClear();
    electronMock.isSupported.mockReturnValue(true);
    electronMock.setAutoEmitShow(true);
    electronMock.resetLastOptions();
    childProcessMock.execFile.mockClear();
    childProcessMock.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        callback: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, "", "");
        return {} as unknown;
      }
    );
  });

  it("blocks ordinary path after sticky denied", async () => {
    electronMock.setAutoEmitShow(false);
    const first = showSystemNotification({ title: "a" });
    for (const listener of electronMock.handlers.get("failed") ?? []) {
      listener({}, "permission denied");
    }
    await expect(first).resolves.toEqual({ reason: "denied", shown: false });

    const second = await showSystemNotification({ title: "b" });
    expect(second).toEqual({ reason: "denied", shown: false });
    expect(electronMock.show).toHaveBeenCalledTimes(1);
    expect(getSystemNotificationPermissionSnapshot().status).toBe("denied");
  });

  it("forceProbe bypasses sticky and can authorize on shown", async () => {
    electronMock.setAutoEmitShow(false);
    const denied = showSystemNotification({ title: "a" });
    for (const listener of electronMock.handlers.get("failed") ?? []) {
      listener({}, "permission denied");
    }
    await denied;

    electronMock.handlers.clear();
    electronMock.setAutoEmitShow(true);
    const probed = await showSystemNotification(
      { title: "test" },
      { forceProbe: true }
    );
    expect(probed).toEqual({ shown: true });
    expect(getSystemNotificationPermissionSnapshot().status).toBe("authorized");

    const again = await showSystemNotification({ title: "c" });
    expect(again).toEqual({ shown: true });
  });

  it("showTestSystemNotification uses forceProbe path", async () => {
    electronMock.setAutoEmitShow(false);
    const denied = showSystemNotification({ title: "a" });
    for (const listener of electronMock.handlers.get("failed") ?? []) {
      listener({}, "permission denied");
    }
    await denied;

    electronMock.handlers.clear();
    electronMock.setAutoEmitShow(true);
    const result = await showTestSystemNotification();
    expect(result.shown).toBe(true);
    expect(getSystemNotificationPermissionSnapshot().status).toBe("authorized");
  });

  it("showTestSystemNotification uses caller copy and defaults to English", async () => {
    await showTestSystemNotification({
      copy: { body: "看到这条横幅说明投递正常。", title: "Pier 测试通知" },
    });
    expect(electronMock.lastOptions).toEqual(
      expect.objectContaining({
        body: "看到这条横幅说明投递正常。",
        title: "Pier 测试通知",
      })
    );

    await showTestSystemNotification();
    expect(electronMock.lastOptions).toEqual(
      expect.objectContaining({ title: "Pier test notification" })
    );
  });

  it("returns unsupported when Notification.isSupported is false", async () => {
    electronMock.isSupported.mockReturnValue(false);
    const result = await showSystemNotification({ title: "x" });
    expect(result).toEqual({ reason: "unsupported", shown: false });
    expect(getSystemNotificationPermissionSnapshot().status).toBe(
      "unsupported"
    );
  });

  it("openSystemNotificationSettings uses macOS open(1), not shell.openExternal", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const result = await openSystemNotificationSettings();
    expect(result.opened).toBe(true);
    expect(childProcessMock.execFile).toHaveBeenCalled();
    expect(childProcessMock.execFile.mock.calls[0]?.[0]).toBe("open");
    expect(electronMock.openExternal).not.toHaveBeenCalled();
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: original,
    });
  });

  it("forwards silent and sound options", async () => {
    electronMock.setAutoEmitShow(true);
    await showSystemNotification(
      { title: "t" },
      { silent: true, sound: "default" }
    );
    expect(electronMock.lastOptions).toMatchObject({
      silent: true,
      sound: "default",
    });
  });

  it("defaults silent false when omitted", async () => {
    electronMock.setAutoEmitShow(true);
    await showSystemNotification({ title: "t" });
    expect(electronMock.lastOptions?.silent).toBe(false);
  });
});
