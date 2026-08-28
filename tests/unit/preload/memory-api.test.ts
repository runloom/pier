import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: {
    getMaxListeners: () => 10,
    invoke: invokeMock,
    setMaxListeners: vi.fn(),
  },
}));

import { memoryApi } from "@preload/memory/api.ts";

const root = { projectRootPath: "/p", scope: "project" as const };

describe("memoryApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      data: { ok: true },
      ok: true,
      requestId: "r1",
    });
  });

  it("forwards enable payload", async () => {
    await memoryApi.enable(root);
    expect(invokeMock).toHaveBeenCalledWith(PIER.COMMAND_EXECUTE, {
      root,
      type: "memory.enable",
    });
  });

  it("forwards disable and status payloads", async () => {
    await memoryApi.disable(root);
    await memoryApi.status(root);
    expect(invokeMock).toHaveBeenNthCalledWith(1, PIER.COMMAND_EXECUTE, {
      root,
      type: "memory.disable",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, PIER.COMMAND_EXECUTE, {
      root,
      type: "memory.status",
    });
  });

  it("forwards list delete and clear payloads", async () => {
    await memoryApi.list(root);
    await memoryApi.deleteObservation(root, "pnpm", 0, "use pnpm");
    await memoryApi.clearStore(root);
    expect(invokeMock).toHaveBeenNthCalledWith(1, PIER.COMMAND_EXECUTE, {
      root,
      type: "memory.list",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, PIER.COMMAND_EXECUTE, {
      entityName: "pnpm",
      index: 0,
      observation: "use pnpm",
      root,
      type: "memory.deleteObservation",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, PIER.COMMAND_EXECUTE, {
      root,
      type: "memory.clearStore",
    });
  });
});
