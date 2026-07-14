import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  inspect: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, payload: unknown) => unknown
      ) => {
        mocks.handlers.set(channel, handler);
      }
    ),
  },
}));
vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    clients: {
      heartbeat: vi.fn(() => ({ capabilities: ["file:read"] })),
      register: vi.fn(),
    },
    services: { plugins: { inspect: mocks.inspect } },
  },
}));
vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "window-1"),
    fromWebContents: vi.fn(() => ({})),
  },
}));

import { registerFilePreviewTicketIpc } from "@main/ipc/file-preview-ticket.ts";

function sender() {
  const mainFrame = {};
  return {
    mainFrame,
    sender: {
      id: 7,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn(),
      once: vi.fn(),
      session: { storagePath: "/partition" },
    },
    senderFrame: mainFrame,
  };
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.inspect.mockReset();
  mocks.inspect.mockResolvedValue({
    effectivePermissions: ["file:read"],
    enabled: true,
    manifest: { id: "pier.files" },
  });
  registerFilePreviewTicketIpc();
});

describe("file preview ticket IPC", () => {
  it("derives an activation lease in main and exchanges tickets for its owner", async () => {
    const event = sender();
    const acquire = mocks.handlers.get(PIER.FILE_PREVIEW_RUNTIME_ACQUIRE);
    const issue = mocks.handlers.get(PIER.FILE_PREVIEW_TICKET_ISSUE);
    const release = mocks.handlers.get(PIER.FILE_PREVIEW_TICKET_RELEASE);
    const acquired = await acquire?.(event, { recordId: "pier.files" });
    expect(acquired).toMatchObject({ acquired: true });
    const leaseId = (acquired as { leaseId: string }).leaseId;

    const first = await issue?.(event, {
      leaseId,
      locator: {
        mime: "image/png",
        path: "one.png",
        revision: "file-v1:one",
        root: "/repo",
      },
    });
    const second = await issue?.(event, {
      leaseId,
      locator: {
        mime: "image/png",
        path: "two.png",
        revision: "file-v1:two",
        root: "/repo",
      },
      previousTicket: (first as { ticket: string }).ticket,
    });

    expect(first).toMatchObject({ issued: true });
    expect(second).toMatchObject({ issued: true });
    await expect(
      release?.(event, {
        leaseId,
        ticket: (first as { ticket: string }).ticket,
      })
    ).resolves.toBe(false);
    await expect(
      release?.(event, {
        leaseId,
        ticket: (second as { ticket: string }).ticket,
      })
    ).resolves.toBe(true);
  });

  it("rejects subframes and plugins without a live file capability", async () => {
    const acquire = mocks.handlers.get(PIER.FILE_PREVIEW_RUNTIME_ACQUIRE);
    const subframeEvent = sender();
    subframeEvent.senderFrame = {};
    await expect(
      acquire?.(subframeEvent, { recordId: "pier.files" })
    ).resolves.toEqual({ acquired: false, reason: "forbidden" });
    const detachedEvent = sender();
    detachedEvent.senderFrame = null as never;
    await expect(
      acquire?.(detachedEvent, { recordId: "pier.files" })
    ).resolves.toEqual({ acquired: false, reason: "forbidden" });

    mocks.inspect.mockResolvedValue({
      effectivePermissions: [],
      enabled: true,
      manifest: { id: "pier.files" },
    });
    await expect(
      acquire?.(sender(), { recordId: "pier.files" })
    ).resolves.toEqual({ acquired: false, reason: "forbidden" });
  });
});
