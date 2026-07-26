import { sendMessageToastToOneWindow } from "@main/app-core/window-broadcasts.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWebContents {
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
}

interface FakeWindow {
  id: number;
  isDestroyed: () => boolean;
  isFocused: () => boolean;
  webContents: FakeWebContents;
}

interface FakeWindowManager {
  __setWindows: (wins: FakeWindow[]) => void;
  getAll: () => FakeWindow[];
  getFocused: () => FakeWindow | null;
}

function makeWindow(
  send: (channel: string, payload: unknown) => void,
  opts: {
    destroyed?: boolean;
    electronId?: number;
    focused?: boolean;
    webContentsDestroyed?: boolean;
  } = {}
): FakeWindow {
  return {
    id: opts.electronId ?? 1,
    isFocused: () => opts.focused ?? false,
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      isDestroyed: () => opts.webContentsDestroyed ?? false,
      send,
    },
  };
}

const state: { windows: FakeWindow[] } = { windows: [] };

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    getAll: () => state.windows,
    getFocused: () => state.windows.find((w) => w.isFocused()) ?? null,
    __setWindows: (wins: FakeWindow[]) => {
      state.windows = wins;
    },
  } satisfies FakeWindowManager,
}));

vi.mock("@main/windows/window-identity.ts", () => ({
  findAppWindowByElectronId: (id: number) =>
    state.windows.find((w) => w.id === id) ?? null,
  findInternalWindowId: () => null,
}));

const windowManager = (await import("@main/windows/window-manager.ts"))
  .windowManager as unknown as FakeWindowManager;

const notification: AppNotification = {
  id: "n1",
  kind: "agent.attention",
  read: false,
  severity: "warning",
  source: "agent-attention",
  title: "Needs you",
  trigger: "system-event",
  ts: 1,
};

describe("sendMessageToastToOneWindow", () => {
  beforeEach(() => {
    windowManager.__setWindows([]);
  });

  it("sends to focused window only for key-window target", () => {
    const focusedSend = vi.fn();
    const otherSend = vi.fn();
    const focused = makeWindow(focusedSend, { focused: true, electronId: 2 });
    const other = makeWindow(otherSend, { electronId: 3 });
    windowManager.__setWindows([other, focused]);

    const sent = sendMessageToastToOneWindow(notification, {
      mode: "key-window",
    });

    expect(sent).toBe(true);
    expect(focusedSend).toHaveBeenCalledWith(
      PIER_BROADCAST.NOTIFICATION_CENTER_MESSAGE_TOAST,
      notification
    );
    expect(otherSend).not.toHaveBeenCalled();
  });

  it("does not fall back to first window when none focused (key-window)", () => {
    const firstSend = vi.fn();
    windowManager.__setWindows([makeWindow(firstSend, { electronId: 1 })]);

    expect(
      sendMessageToastToOneWindow(notification, { mode: "key-window" })
    ).toBe(false);
    expect(firstSend).not.toHaveBeenCalled();
  });

  it("sends to origin window for origin-window target", () => {
    const originSend = vi.fn();
    const focusedSend = vi.fn();
    const origin = makeWindow(originSend, { electronId: 10 });
    const focused = makeWindow(focusedSend, { focused: true, electronId: 11 });
    windowManager.__setWindows([origin, focused]);

    const sent = sendMessageToastToOneWindow(notification, {
      mode: "origin-window",
      originWindowId: "10",
    });

    expect(sent).toBe(true);
    expect(originSend).toHaveBeenCalledTimes(1);
    expect(focusedSend).not.toHaveBeenCalled();
  });

  it("falls back to key window when origin is destroyed", () => {
    const focusedSend = vi.fn();
    const dead = makeWindow(vi.fn(), { destroyed: true, electronId: 10 });
    const focused = makeWindow(focusedSend, { focused: true, electronId: 11 });
    windowManager.__setWindows([dead, focused]);

    expect(
      sendMessageToastToOneWindow(notification, {
        mode: "origin-window",
        originWindowId: "10",
      })
    ).toBe(true);
    expect(focusedSend).toHaveBeenCalledTimes(1);
  });

  it("returns false for mode none", () => {
    windowManager.__setWindows([
      makeWindow(vi.fn(), { focused: true, electronId: 1 }),
    ]);
    expect(sendMessageToastToOneWindow(notification, { mode: "none" })).toBe(
      false
    );
  });
});
