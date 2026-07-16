import type { AgentRuntimeFocusResult } from "@shared/contracts/agent-runtime-index.ts";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const constructed: Record<string, unknown>[] = [];
  const show = vi.fn();
  const close = vi.fn();
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const isSupported = vi.fn(() => true);
  let autoEmitShow = true;
  class MockNotification {
    static isSupported = isSupported;
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
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
  }
  return {
    autoEmitShow: {
      get: () => autoEmitShow,
      set: (value: boolean) => {
        autoEmitShow = value;
      },
    },
    close,
    constructed,
    handlers,
    isSupported,
    MockNotification,
    show,
  };
});

const focusFeedback = vi.hoisted(() => ({
  broadcastAgentRuntimeFocusFeedback: vi.fn(),
  broadcastSystemNotificationPermissionChanged: vi.fn(),
}));

vi.mock("electron", () => ({
  Notification: electronMock.MockNotification,
  app: {
    focus: vi.fn(),
    hide: vi.fn(),
    isPackaged: true,
  },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

vi.mock("@main/app-core/window-broadcasts.ts", () => focusFeedback);

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    getAll: () => [],
    getFocused: () => null,
  },
}));

import { registerNotificationIpc } from "@main/ipc/notification.ts";
import { resetSystemNotificationPermissionStateForTests } from "@main/services/system-notification.ts";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function setupHandler(
  focus?: (agentRef: string) => Promise<AgentRuntimeFocusResult>
) {
  const handlers = new Map<string, InvokeHandler>();
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    },
  } as unknown as IpcMain;
  registerNotificationIpc(
    ipcMain,
    focus
      ? {
          index: {
            focus,
            focusWaiting: async () => ({ status: "empty" as const }),
            listMachine: () => ({ entries: [], ts: 1 }),
          },
        }
      : {}
  );
  const handler = handlers.get("pier:notification:system");
  if (!handler) {
    throw new Error("expected pier:notification:system handler");
  }
  return handler;
}

describe("notification IPC", () => {
  beforeEach(() => {
    electronMock.constructed.length = 0;
    electronMock.handlers.clear();
    electronMock.isSupported.mockReturnValue(true);
    electronMock.autoEmitShow.set(true);
    resetSystemNotificationPermissionStateForTests();
    vi.clearAllMocks();
  });

  it("shows a system notification with title and body", async () => {
    const handler = setupHandler();

    const result = await handler({} as IpcMainInvokeEvent, {
      body: "Rebase finished",
      title: "Pier",
    });

    expect(electronMock.constructed).toEqual([
      { body: "Rebase finished", silent: false, title: "Pier" },
    ]);
    expect(electronMock.show).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ shown: true });
  });

  it("omits body when the request has none", async () => {
    const handler = setupHandler();

    await handler({} as IpcMainInvokeEvent, { title: "Pier" });

    expect(electronMock.constructed).toEqual([
      { silent: false, title: "Pier" },
    ]);
  });

  it("reports shown=false without constructing when unsupported", async () => {
    electronMock.isSupported.mockReturnValue(false);
    const handler = setupHandler();

    const result = await handler({} as IpcMainInvokeEvent, { title: "Pier" });

    expect(electronMock.constructed).toEqual([]);
    expect(electronMock.show).not.toHaveBeenCalled();
    expect(result).toEqual({ reason: "unsupported", shown: false });
  });

  it("treats failed permission errors as denied and sticks", async () => {
    electronMock.autoEmitShow.set(false);
    const handler = setupHandler();

    const pending = handler({} as IpcMainInvokeEvent, { title: "Pier" });
    const failed = electronMock.handlers.get("failed") ?? [];
    for (const cb of [...failed]) {
      cb({}, "permission denied by user");
    }
    await expect(pending).resolves.toEqual({
      reason: "denied",
      shown: false,
    });

    electronMock.autoEmitShow.set(true);
    await expect(
      handler({} as IpcMainInvokeEvent, { title: "Again" })
    ).resolves.toEqual({ reason: "denied", shown: false });
    expect(electronMock.constructed).toHaveLength(1);
  });

  it("focuses agentRef on click and broadcasts non-ok results", async () => {
    const focusAgent = vi.fn(async () => ({ status: "panel_gone" as const }));
    const handler = setupHandler(focusAgent);

    await handler({} as IpcMainInvokeEvent, {
      agentRef: "1\0p1",
      kind: "agent.attention",
      title: "Claude",
    });

    const clickHandlers = electronMock.handlers.get("click") ?? [];
    expect(clickHandlers.length).toBeGreaterThan(0);
    clickHandlers[0]?.();
    await vi.waitFor(() => {
      expect(focusAgent).toHaveBeenCalledWith("1\0p1");
    });
    expect(
      focusFeedback.broadcastAgentRuntimeFocusFeedback
    ).toHaveBeenCalledWith({ status: "panel_gone" });
  });
});
