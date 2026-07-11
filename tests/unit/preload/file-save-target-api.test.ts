import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: { invoke: invokeMock },
}));

import { fileSaveTargetApi } from "@preload/file-save-target-api.ts";

const request = {
  context: {
    contextId: "ctx:repo",
    projectRootPath: "/repo",
    updatedAt: 1,
  },
  suggestedName: "notes.md",
};

describe("fileSaveTargetApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the dedicated IPC channel and validates the response", async () => {
    const target = {
      context: request.context,
      path: "notes.md",
      root: "/repo",
    };
    invokeMock.mockResolvedValue(target);

    await expect(fileSaveTargetApi.pickSaveTarget(request)).resolves.toEqual(
      target
    );
    expect(invokeMock).toHaveBeenCalledWith(
      PIER.FILE_PICK_SAVE_TARGET,
      request
    );
  });

  it("preserves cancellation and rejects malformed main-process results", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(fileSaveTargetApi.pickSaveTarget(request)).resolves.toBeNull();

    invokeMock.mockResolvedValueOnce({
      context: request.context,
      path: "/absolute.md",
      root: "/repo",
    });
    await expect(fileSaveTargetApi.pickSaveTarget(request)).rejects.toThrow();
  });
});
