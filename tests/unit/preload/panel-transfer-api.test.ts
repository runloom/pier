import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcInvokeMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: {
    invoke: ipcInvokeMock,
  },
}));

import { createPanelTransferApi } from "@preload/panel-transfer-api.ts";

const TRANSFER_ID = "9af45a46-24f2-4ac0-9371-fbe78ca295dc";

const movableOffer = {
  version: 1 as const,
  transferId: TRANSFER_ID,
  capability: "movable" as const,
  panel: {
    componentId: "files.editor",
    panelId: "panel-files-1",
    title: "notes.md",
  },
};

describe("panelTransfer preload API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards offer/drop/finishDrag/cancel/bootstrap/ready through PierCommand", async () => {
    const api = createPanelTransferApi();

    ipcInvokeMock.mockResolvedValueOnce({
      data: { accepted: true },
      ok: true,
      requestId: "r1",
    });
    await expect(api.offer(movableOffer)).resolves.toEqual({ accepted: true });
    expect(ipcInvokeMock).toHaveBeenLastCalledWith(PIER.COMMAND_EXECUTE, {
      type: "panelTransfer.offer",
      offer: movableOffer,
    });

    ipcInvokeMock.mockResolvedValueOnce({
      data: { ok: true, targetPanelId: "panel-files-1" },
      ok: true,
      requestId: "r2",
    });
    await expect(
      api.drop({
        transferId: TRANSFER_ID,
        placement: { kind: "root" },
      })
    ).resolves.toEqual({ ok: true, targetPanelId: "panel-files-1" });
    expect(ipcInvokeMock).toHaveBeenLastCalledWith(PIER.COMMAND_EXECUTE, {
      type: "panelTransfer.drop",
      transferId: TRANSFER_ID,
      placement: { kind: "root" },
    });

    ipcInvokeMock.mockResolvedValueOnce({
      data: null,
      ok: true,
      requestId: "r3",
    });
    await expect(api.finishDrag(TRANSFER_ID)).resolves.toBeNull();
    expect(ipcInvokeMock).toHaveBeenLastCalledWith(PIER.COMMAND_EXECUTE, {
      type: "panelTransfer.finishDrag",
      transferId: TRANSFER_ID,
    });

    ipcInvokeMock.mockResolvedValueOnce({
      data: null,
      ok: true,
      requestId: "r4",
    });
    await expect(api.cancel(TRANSFER_ID)).resolves.toBeUndefined();
    expect(ipcInvokeMock).toHaveBeenLastCalledWith(PIER.COMMAND_EXECUTE, {
      type: "panelTransfer.cancel",
      transferId: TRANSFER_ID,
    });

    ipcInvokeMock.mockResolvedValueOnce({
      data: { pending: [] },
      ok: true,
      requestId: "r5",
    });
    await expect(api.bootstrap()).resolves.toEqual({ pending: [] });
    expect(ipcInvokeMock).toHaveBeenLastCalledWith(PIER.COMMAND_EXECUTE, {
      type: "panelTransfer.bootstrap",
    });

    ipcInvokeMock.mockResolvedValueOnce({
      data: {
        ok: false,
        code: "not_supported",
        message: "unsupported",
      },
      ok: true,
      requestId: "r6",
    });
    await expect(api.ready(TRANSFER_ID)).resolves.toEqual({
      ok: false,
      code: "not_supported",
      message: "unsupported",
    });
    expect(ipcInvokeMock).toHaveBeenLastCalledWith(PIER.COMMAND_EXECUTE, {
      type: "panelTransfer.ready",
      transferId: TRANSFER_ID,
    });
  });

  it("surfaces PierCommand errors from the envelope", async () => {
    const api = createPanelTransferApi();
    ipcInvokeMock.mockResolvedValueOnce({
      error: { code: "permission_denied", message: "nope" },
      ok: false,
      requestId: "r-err",
    });

    await expect(api.cancel(TRANSFER_ID)).rejects.toMatchObject({
      code: "permission_denied",
      message: "nope",
    });
  });
});
