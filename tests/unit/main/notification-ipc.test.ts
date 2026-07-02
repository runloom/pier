import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const constructed: Record<string, unknown>[] = [];
  const show = vi.fn();
  const isSupported = vi.fn(() => true);
  class MockNotification {
    static isSupported = isSupported;
    show = show;
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
  }
  return { constructed, isSupported, MockNotification, show };
});

vi.mock("electron", () => ({
  Notification: electronMock.MockNotification,
}));

import { registerNotificationIpc } from "@main/ipc/notification.ts";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function setupHandler(): InvokeHandler {
  const handlers = new Map<string, InvokeHandler>();
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    },
  } as unknown as IpcMain;
  registerNotificationIpc(ipcMain);
  const handler = handlers.get("pier:notification:system");
  if (!handler) {
    throw new Error("expected pier:notification:system handler");
  }
  return handler;
}

describe("notification IPC", () => {
  beforeEach(() => {
    electronMock.constructed.length = 0;
    electronMock.isSupported.mockReturnValue(true);
    vi.clearAllMocks();
  });

  it("shows a system notification with title and body", () => {
    const handler = setupHandler();

    const result = handler({} as IpcMainInvokeEvent, {
      body: "Rebase finished",
      title: "Pier",
    });

    expect(electronMock.constructed).toEqual([
      { body: "Rebase finished", title: "Pier" },
    ]);
    expect(electronMock.show).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ shown: true });
  });

  it("omits body when the request has none", () => {
    const handler = setupHandler();

    handler({} as IpcMainInvokeEvent, { title: "Pier" });

    expect(electronMock.constructed).toEqual([{ title: "Pier" }]);
  });

  it("reports shown=false without constructing when unsupported", () => {
    electronMock.isSupported.mockReturnValue(false);
    const handler = setupHandler();

    const result = handler({} as IpcMainInvokeEvent, { title: "Pier" });

    expect(electronMock.constructed).toEqual([]);
    expect(electronMock.show).not.toHaveBeenCalled();
    expect(result).toEqual({ shown: false });
  });
});
