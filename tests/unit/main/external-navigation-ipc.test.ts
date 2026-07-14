import { registerExternalNavigationIpc } from "@main/ipc/external-navigation.ts";
import type { ExternalNavigationService } from "@main/services/external-navigation.ts";
import type { AppWindow } from "@main/windows/app-window.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

type Handler = (
  event: {
    sender: WebContents;
    senderFrame: unknown;
  },
  payload: unknown
) => Promise<unknown>;

function setup(options: { focused?: boolean; recognized?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  } as unknown as IpcMain;
  const mainFrame = {};
  const sender = {
    isDestroyed: vi.fn(() => false),
    mainFrame,
  } as unknown as WebContents;
  const window = {
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => options.focused ?? true),
    webContents: sender,
  } as unknown as AppWindow;
  const service = {
    open: vi.fn(async () => ({ opened: true as const })),
  } satisfies ExternalNavigationService;

  registerExternalNavigationIpc(ipcMain, {
    service,
    windowForSender: () => (options.recognized === false ? null : window),
  });

  const handler = handlers.get(PIER.EXTERNAL_NAVIGATION_OPEN);
  if (!handler) {
    throw new Error("external navigation handler was not registered");
  }
  return { handler, mainFrame, sender, service };
}

const request = {
  issuedAt: 100,
  nonce: "0123456789abcdef0123456789abcdef",
  url: "https://example.com",
};

describe("external navigation IPC", () => {
  it("invokes the service for the focused owning Pier window", async () => {
    const { handler, mainFrame, sender, service } = setup();

    await expect(
      handler({ sender, senderFrame: mainFrame }, request)
    ).resolves.toEqual({
      opened: true,
    });
    expect(service.open).toHaveBeenCalledWith(request);
  });

  it.each([
    ["unrecognized sender", { recognized: false }, true],
    ["unfocused window", { focused: false }, true],
    ["subframe sender", {}, false],
  ] as const)("rejects a %s without reaching the service", async (_label, options, mainFrameMatches) => {
    const { handler, mainFrame, sender, service } = setup(options);

    await expect(
      handler(
        { sender, senderFrame: mainFrameMatches ? mainFrame : {} },
        request
      )
    ).resolves.toEqual({ opened: false, reason: "not-focused" });
    expect(service.open).not.toHaveBeenCalled();
  });

  it("returns a typed failure for malformed payloads", async () => {
    const { handler, mainFrame, sender, service } = setup();

    await expect(
      handler(
        { sender, senderFrame: mainFrame },
        { url: "https://example.com" }
      )
    ).resolves.toEqual({ opened: false, reason: "invalid-request" });
    expect(service.open).not.toHaveBeenCalled();
  });
});
