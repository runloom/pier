import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const broadcastMock = vi.hoisted(() => ({
  broadcastAgentRuntimeIndexChanged: vi.fn(),
}));

const faPublishMock = vi.hoisted(() => {
  let listener: ((b: { activities: []; ts: number }) => void) | null = null;
  return {
    onForegroundActivityPublished: vi.fn(
      (cb: (b: { activities: []; ts: number }) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }
    ),
    publish() {
      listener?.({ activities: [], ts: 1 });
    },
  };
});

vi.mock("@main/app-core/window-broadcasts.ts", () => broadcastMock);
vi.mock("@main/ipc/foreground-activity.ts", () => ({
  onForegroundActivityPublished: faPublishMock.onForegroundActivityPublished,
}));

import { registerAgentRuntimeIndexIpc } from "@main/ipc/agent-runtime-index.ts";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function setup(index: AgentRuntimeIndexService): Map<string, InvokeHandler> {
  const handlers = new Map<string, InvokeHandler>();
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    },
  } as unknown as IpcMain;
  registerAgentRuntimeIndexIpc(ipcMain, index);
  return handlers;
}

describe("agent-runtime-index IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires list / focus / focusWaiting handlers", async () => {
    const listMachine = vi.fn(() => ({ entries: [], ts: 3 }));
    const focus = vi.fn(async () => ({ status: "ok" as const }));
    const focusWaiting = vi.fn(async () => ({ status: "empty" as const }));
    const handlers = setup({ listMachine, focus, focusWaiting });

    expect(
      handlers.get(PIER.AGENT_RUNTIME_INDEX_LIST)?.({} as IpcMainInvokeEvent)
    ).toEqual({ entries: [], ts: 3 });

    const ref = makeAgentRef("1", "p1");
    await expect(
      handlers.get(PIER.AGENT_RUNTIME_INDEX_FOCUS)?.({} as IpcMainInvokeEvent, {
        agentRef: ref,
      })
    ).resolves.toEqual({ status: "ok" });
    expect(focus).toHaveBeenCalledWith(ref);

    await expect(
      handlers.get(PIER.AGENT_RUNTIME_INDEX_FOCUS_WAITING)?.(
        {} as IpcMainInvokeEvent,
        { preferredWindowId: "11" }
      )
    ).resolves.toEqual({ status: "empty" });
    expect(focusWaiting).toHaveBeenCalledWith({ preferredWindowId: "11" });
  });

  it("rejects invalid focus payload without calling service", async () => {
    const focus = vi.fn(async () => ({ status: "ok" as const }));
    const handlers = setup({
      listMachine: () => ({ entries: [], ts: 1 }),
      focus,
      focusWaiting: async () => ({ status: "empty" }),
    });

    await expect(
      handlers.get(PIER.AGENT_RUNTIME_INDEX_FOCUS)?.({} as IpcMainInvokeEvent, {
        agentRef: "",
      })
    ).resolves.toMatchObject({ status: "error" });
    expect(focus).not.toHaveBeenCalled();
  });

  it("pushes index snapshot after FA publish", () => {
    const snapshot = { entries: [], ts: 9 };
    setup({
      listMachine: () => snapshot,
      focus: async () => ({ status: "ok" }),
      focusWaiting: async () => ({ status: "empty" }),
    });

    expect(faPublishMock.onForegroundActivityPublished).toHaveBeenCalled();
    faPublishMock.publish();
    expect(
      broadcastMock.broadcastAgentRuntimeIndexChanged
    ).toHaveBeenCalledWith(snapshot);
    expect(PIER_BROADCAST.AGENT_RUNTIME_INDEX_CHANGED).toBe(
      "pier://agent-runtime-index:changed"
    );
  });
});
