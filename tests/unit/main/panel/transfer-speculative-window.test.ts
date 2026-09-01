import {
  createSpeculativeTransferWindow,
  materializeInternalTransferWindow,
} from "@main/services/panel-transfer/speculative-window.ts";
import type {
  PanelTransferGeometryPort,
  PanelTransferWindowPort,
} from "@main/services/panel-transfer/types.ts";
import { describe, expect, it, vi } from "vitest";

function geometry(): PanelTransferGeometryPort {
  return {
    getCursorScreenPoint: () => ({ x: 5000, y: 5000 }),
    getDisplayWorkAreaNear: () => ({ height: 1000, width: 1600, x: 0, y: 0 }),
    getWindowBounds: () => ({ height: 800, width: 1200, x: 0, y: 0 }),
    getWindowContentBounds: () => ({ height: 760, width: 1200, x: 0, y: 40 }),
    getWindowZOrderTopFirst: () => null,
    isLeftMouseButtonDown: () => false,
  };
}

function windowsPort() {
  const lease = { token: Symbol("lease") };
  return {
    closeAfterTransfer: vi.fn(async () => undefined),
    closeOpenWindowRecord: vi.fn(async () => undefined),
    createForTransfer: vi.fn(async () => ({
      recordId: "record-new",
      windowId: "w-new",
    })),
    destroyForTransfer: vi.fn(async () => undefined),
    focus: vi.fn(),
    holdRendererShow: vi.fn(),
    list: () => [{ focused: true, id: "main", recordId: "record-main" }],
    releaseRendererShow: vi.fn(),
    revealHost: vi.fn(),
    runExclusive: vi.fn(async (operation) => operation(lease)),
    setBounds: vi.fn(),
  } satisfies PanelTransferWindowPort;
}

describe("speculative transfer window", () => {
  it("ensure creates once and take consumes it", async () => {
    const windows = windowsPort();
    const speculative = createSpeculativeTransferWindow({
      geometry: geometry(),
      windows,
    });
    speculative.ensure("t1", "main");
    const warmed = await speculative.awaitReady("t1");
    expect(warmed).toEqual({ recordId: "record-new", windowId: "w-new" });
    expect(windows.createForTransfer).toHaveBeenCalledOnce();
    expect(speculative.hiddenIds().has("w-new")).toBe(true);
    expect(speculative.take("t1")).toEqual(warmed);
    expect(speculative.take("t1")).toBeNull();
    expect(speculative.hiddenIds().size).toBe(0);
  });

  it("discard destroys a ready window and ensure can start again", async () => {
    const windows = windowsPort();
    const speculative = createSpeculativeTransferWindow({
      geometry: geometry(),
      windows,
    });
    speculative.ensure("t1", "main");
    await speculative.awaitReady("t1");
    speculative.discard("t1");
    await vi.waitFor(() =>
      expect(windows.destroyForTransfer).toHaveBeenCalledOnce()
    );
    expect(speculative.take("t1")).toBeNull();
    speculative.ensure("t1", "main");
    await speculative.awaitReady("t1");
    expect(windows.createForTransfer).toHaveBeenCalledTimes(2);
  });

  it("materialize reveals host chrome immediately", async () => {
    const windows = windowsPort();
    const speculative = createSpeculativeTransferWindow({
      geometry: geometry(),
      windows,
    });
    const created = await materializeInternalTransferWindow({
      geometry: geometry(),
      lease: { token: Symbol("lease") },
      sourceWindowId: "main",
      speculative,
      transferId: "t1",
      windows,
    });
    expect(created.windowId).toBe("w-new");
    expect(windows.revealHost).toHaveBeenCalledWith("w-new");
    expect(windows.createForTransfer).toHaveBeenCalledOnce();
  });
});
