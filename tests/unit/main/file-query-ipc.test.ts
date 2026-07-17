import { registerFileQueryIpc } from "@main/ipc/file-query.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/**
 * IPC gate tests for `registerFileQueryIpc` — the wiring around the service.
 *
 * The service itself is covered in `file-query-service.test.ts`; here we lock
 * the IPC contract:
 *   - capability check mirrors `registerFileWatchIpc` (`file:read`).
 *   - payload validation rejects malformed start/cancel without touching the service.
 *   - a validated start invokes the service exactly once with the sender id.
 *   - cancel forwards to `service.cancel(senderId, queryId)`.
 *   - `webContents` destroyed / navigation cancels the sender's sessions.
 */

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        }
      ),
    },
  };
});

const serviceMock = vi.hoisted(() => ({
  cancel: vi.fn(),
  cancelAll: vi.fn(),
  start: vi.fn(),
}));

const createFileQueryService = vi.hoisted(() => vi.fn(() => serviceMock));

const heartbeat = vi.hoisted(() =>
  vi.fn(() => ({ capabilities: ["file:read"] as string[] }))
);

const listIgnored = vi.hoisted(() => vi.fn(async () => [] as string[]));

vi.mock("electron", () => ({ ipcMain: electronMock.ipcMain }));
vi.mock("@main/services/file-query/file-query-service.ts", () => ({
  createFileQueryService,
}));
vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    clients: {
      heartbeat,
      register: vi.fn(),
    },
    services: {
      git: { listIgnored },
    },
  },
}));
vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "main"),
    fromWebContents: vi.fn(() => ({ id: 1 })),
  },
}));

interface FakeSender {
  destroyed: Record<string, () => void>;
  id: number;
  isDestroyed: Mock;
  lifecycle: Record<string, () => void>;
  on: Mock;
  once: Mock;
  send: Mock;
}

function makeSender(): FakeSender {
  const lifecycle: Record<string, () => void> = {};
  const destroyed: Record<string, () => void> = {};
  return {
    destroyed,
    id: 42,
    isDestroyed: vi.fn(() => false),
    lifecycle,
    on: vi.fn((event: string, listener: () => void) => {
      lifecycle[event] = listener;
    }),
    once: vi.fn((event: string, listener: () => void) => {
      destroyed[event] = listener;
    }),
    send: vi.fn(),
  };
}

function validStart() {
  return {
    limit: 50,
    owner: "quick-open:s1",
    query: "theme",
    queryId: "q1",
    root: "/repo",
  };
}

describe("registerFileQueryIpc", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    serviceMock.cancel.mockClear();
    serviceMock.cancelAll.mockClear();
    serviceMock.start.mockClear();
    createFileQueryService.mockClear();
    heartbeat.mockReset();
    heartbeat.mockReturnValue({ capabilities: ["file:read"] });
    listIgnored.mockClear();
  });

  it("rejects start when sender lacks file:read capability", async () => {
    heartbeat.mockReturnValue({ capabilities: [] });
    registerFileQueryIpc();
    const start = electronMock.handlers.get(PIER.FILE_QUERY_START);
    if (!start) throw new Error("missing start handler");

    const sender = makeSender();
    const result = await start({ sender }, validStart());

    expect(result).toBe(false);
    expect(serviceMock.start).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("rejects start on malformed payloads without touching the service", async () => {
    registerFileQueryIpc();
    const start = electronMock.handlers.get(PIER.FILE_QUERY_START);
    if (!start) throw new Error("missing start handler");

    const sender = makeSender();
    const bad = {
      mruPaths: ["/abs/no.ts"],
      query: "theme",
      queryId: "q1",
      root: "/repo",
      unknown: true,
    };

    expect(await start({ sender }, bad)).toBe(false);
    expect(await start({ sender }, "not-an-object")).toBe(false);
    expect(await start({ sender }, null)).toBe(false);
    expect(serviceMock.start).not.toHaveBeenCalled();
  });

  it("forwards a validated start to the service and pipes events to the sender", async () => {
    registerFileQueryIpc();
    const start = electronMock.handlers.get(PIER.FILE_QUERY_START);
    if (!start) throw new Error("missing start handler");

    const sender = makeSender();
    const result = await start({ sender }, validStart());

    expect(result).toBe(true);
    expect(serviceMock.start).toHaveBeenCalledOnce();
    const [senderId, parsed, emit] = serviceMock.start.mock.calls[0] ?? [];
    expect(senderId).toBe(42);
    expect(parsed).toMatchObject({
      limit: 50,
      owner: "quick-open:s1",
      query: "theme",
      queryId: "q1",
      root: "/repo",
    });
    if (typeof emit !== "function") throw new Error("emit must be a function");
    emit({ kind: "started", queryId: "q1" });
    expect(sender.send).toHaveBeenCalledWith(PIER.FILE_QUERY_EVENT, {
      kind: "started",
      queryId: "q1",
    });
  });

  it("assigns a queryId when the payload omits it", async () => {
    registerFileQueryIpc();
    const start = electronMock.handlers.get(PIER.FILE_QUERY_START);
    if (!start) throw new Error("missing start handler");

    const { queryId: _drop, ...withoutId } = validStart();
    const sender = makeSender();
    const result = await start({ sender }, withoutId);

    expect(result).toBe(true);
    expect(serviceMock.start).toHaveBeenCalledOnce();
    const [, parsed] = serviceMock.start.mock.calls[0] ?? [];
    const generated = (parsed as { queryId?: unknown } | undefined)?.queryId;
    expect(typeof generated).toBe("string");
    expect((generated as string).length).toBeGreaterThan(0);
  });

  it("does not send events after the webContents is destroyed", async () => {
    registerFileQueryIpc();
    const start = electronMock.handlers.get(PIER.FILE_QUERY_START);
    if (!start) throw new Error("missing start handler");

    const sender = makeSender();
    await start({ sender }, validStart());
    const [, , emit] = serviceMock.start.mock.calls[0] ?? [];
    if (typeof emit !== "function") throw new Error("emit must be a function");

    sender.isDestroyed.mockReturnValue(true);
    emit({ kind: "started", queryId: "q1" });

    expect(sender.send).not.toHaveBeenCalled();
  });

  it("cancels the sender's sessions on renderer lifecycle end", async () => {
    registerFileQueryIpc();
    const start = electronMock.handlers.get(PIER.FILE_QUERY_START);
    if (!start) throw new Error("missing start handler");

    const sender = makeSender();
    await start({ sender }, validStart());

    sender.destroyed.destroyed?.();
    expect(serviceMock.cancelAll).toHaveBeenCalledWith(42);

    serviceMock.cancelAll.mockClear();
    sender.lifecycle["did-navigate"]?.();
    expect(serviceMock.cancelAll).toHaveBeenCalledWith(42);
  });

  it("rejects cancel on malformed payload and forwards a valid one to the service", async () => {
    registerFileQueryIpc();
    const cancel = electronMock.handlers.get(PIER.FILE_QUERY_CANCEL);
    if (!cancel) throw new Error("missing cancel handler");

    const sender = makeSender();
    expect(await cancel({ sender }, "not-an-object")).toBe(false);
    expect(await cancel({ sender }, { queryId: 123 })).toBe(false);
    expect(await cancel({ sender }, { queryId: "" })).toBe(false);
    expect(serviceMock.cancel).not.toHaveBeenCalled();

    const ok = await cancel({ sender }, { queryId: "q1" });
    expect(ok).toBe(true);
    expect(serviceMock.cancel).toHaveBeenCalledWith(42, "q1");
  });
});
