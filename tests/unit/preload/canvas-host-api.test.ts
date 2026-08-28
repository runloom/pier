import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const onMock = vi.hoisted(() => vi.fn());
const offMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: {
    invoke: invokeMock,
    off: offMock,
    on: onMock,
    setMaxListeners: vi.fn(),
    getMaxListeners: () => 10,
  },
}));

import { canvasHostApi } from "@preload/canvas-host-api.ts";

describe("canvasHostApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    onMock.mockReset();
    offMock.mockReset();
  });

  it("sends allowlisted commands on the canvas execute channel", async () => {
    invokeMock.mockResolvedValue({
      data: [],
      ok: true,
      requestId: "request-1",
    });
    await canvasHostApi.invoke({ path: "", root: "/tmp", type: "file.list" });
    expect(invokeMock).toHaveBeenCalledWith(PIER.CANVAS_COMMAND_EXECUTE, {
      path: "",
      root: "/tmp",
      type: "file.list",
    });
  });

  it("rejects writes before IPC", async () => {
    await expect(
      canvasHostApi.invoke({
        contents: "x",
        path: "notes.md",
        root: "/tmp",
        type: "file.writeText",
      })
    ).rejects.toThrow(/canvas host denies file.writeText/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("allows canvasCommand.invoke on the canvas execute channel", async () => {
    invokeMock.mockResolvedValue({
      data: { kind: "cancelled" },
      ok: true,
      requestId: "request-2",
    });
    await canvasHostApi.invoke({
      payload: {
        canvasPath: ".pier/canvases/demo/hello.canvas.tsx",
        key: "refresh",
        projectRootPath: "/tmp/proj",
      },
      type: "canvasCommand.invoke",
    });
    expect(invokeMock).toHaveBeenCalledWith(PIER.CANVAS_COMMAND_EXECUTE, {
      payload: {
        canvasPath: ".pier/canvases/demo/hello.canvas.tsx",
        key: "refresh",
        projectRootPath: "/tmp/proj",
      },
      type: "canvasCommand.invoke",
    });
  });
});
