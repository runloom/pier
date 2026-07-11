import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcInvokeMock = vi.hoisted(() => vi.fn());
const ipcOnMock = vi.hoisted(() => vi.fn());
const ipcOffMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: {
    invoke: ipcInvokeMock,
    off: ipcOffMock,
    on: ipcOnMock,
  },
}));

import { tasksApi } from "@preload/task-api.ts";

describe("tasks preload API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the task run snapshot", async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      data: { runs: {}, version: 0 },
      ok: true,
      requestId: "request-1",
    });

    await expect(tasksApi.runsSnapshot()).resolves.toEqual({
      runs: {},
      version: 0,
    });
    expect(ipcInvokeMock).toHaveBeenCalledWith(PIER.COMMAND_EXECUTE, {
      type: "run.runsSnapshot",
    });
  });

  it("subscribes and unsubscribes from run snapshots", () => {
    const callback = vi.fn();
    const dispose = tasksApi.onRunsChanged(callback);
    const listener = ipcOnMock.mock.calls[0]?.[1] as
      | ((event: unknown, payload: unknown) => void)
      | undefined;
    const update = { runs: {}, version: 1 };

    listener?.({}, update);
    expect(callback).toHaveBeenCalledWith(update);
    expect(ipcOnMock).toHaveBeenCalledWith(
      PIER_BROADCAST.TASKS_RUNS_CHANGED,
      listener
    );
    dispose();
    expect(ipcOffMock).toHaveBeenCalledWith(
      PIER_BROADCAST.TASKS_RUNS_CHANGED,
      listener
    );
  });
});
