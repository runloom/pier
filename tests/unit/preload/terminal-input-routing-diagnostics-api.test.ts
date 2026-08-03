import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: {
    getMaxListeners: () => 10,
    invoke: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    send: sendMock,
    setMaxListeners: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}));

import { terminalApi } from "@preload/terminal-api.ts";

describe("terminalApi input-routing diagnostics", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("forwards only the renderer diagnostic payload through its dedicated channel", () => {
    const event = {
      action: "ended" as const,
      panelId: "terminal-1",
      reason: "window-dragend" as const,
      sessionId: "dockview-tab-drag:1",
      source: "workspace-tab-drag" as const,
    };

    terminalApi.recordInputRoutingDiagnostic(event);

    expect(sendMock).toHaveBeenCalledExactlyOnceWith(
      PIER.TERMINAL_INPUT_ROUTING_DIAGNOSTIC,
      event
    );
  });
});
