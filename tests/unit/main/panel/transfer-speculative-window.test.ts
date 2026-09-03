import { computeTransferNewWindowBounds } from "@main/services/panel-transfer/helpers.ts";
import {
  createSpeculativeTransferWindow,
  materializeInternalTransferWindow,
} from "@main/services/panel-transfer/speculative-window.ts";
import type {
  PanelTransferGeometryPort,
  PanelTransferWindowPort,
} from "@main/services/panel-transfer/types.ts";
import { describe, expect, it, vi } from "vitest";

function geometry(
  overrides?: Partial<PanelTransferGeometryPort>
): PanelTransferGeometryPort {
  return {
    getCursorScreenPoint: () => ({ x: 5000, y: 5000 }),
    getDisplayWorkAreaNear: () => ({ height: 1000, width: 1600, x: 0, y: 0 }),
    getWindowBounds: () => ({ height: 800, width: 1200, x: 0, y: 0 }),
    getWindowContentBounds: () => ({ height: 760, width: 1200, x: 0, y: 40 }),
    getWindowZOrderTopFirst: () => null,
    isLeftMouseButtonDown: () => false,
    ...overrides,
  };
}

function createWindowsPort() {
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
    list: (): ReturnType<PanelTransferWindowPort["list"]> => [
      { focused: true, id: "main", recordId: "record-main" },
    ],
    releaseRendererShow: vi.fn(),
    revealHost: vi.fn(),
    runExclusive: vi.fn(async (operation) => operation(lease)),
    setBounds: vi.fn(),
  } satisfies PanelTransferWindowPort;
}

function windowsPort(
  overrides?: Partial<ReturnType<typeof createWindowsPort>>
): ReturnType<typeof createWindowsPort> {
  return {
    ...createWindowsPort(),
    ...overrides,
  };
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

  it("hiddenIds includes a window that appears in list() before create resolves", async () => {
    const listed: Array<{ focused: boolean; id: string; recordId: string }> = [
      { focused: true, id: "main", recordId: "record-main" },
    ];
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const windows = windowsPort({
      createForTransfer: vi.fn(async () => {
        listed.push({ focused: false, id: "w-new", recordId: "record-new" });
        await createGate;
        return { recordId: "record-new", windowId: "w-new" };
      }),
      list: () => listed,
    });
    const speculative = createSpeculativeTransferWindow({
      geometry: geometry(),
      windows,
    });
    speculative.ensure("t1", "main");
    await vi.waitFor(() =>
      expect(listed.some((info) => info.id === "w-new")).toBe(true)
    );
    expect(speculative.hiddenIds().has("w-new")).toBe(true);
    releaseCreate();
    await speculative.awaitReady("t1");
    expect(speculative.hiddenIds().has("w-new")).toBe(true);
  });

  it("hiddenIds keeps a discarded window until destroyForTransfer finishes", async () => {
    const listed: Array<{ focused: boolean; id: string; recordId: string }> = [
      { focused: true, id: "main", recordId: "record-main" },
    ];
    let releaseDestroy!: () => void;
    const destroyGate = new Promise<void>((resolve) => {
      releaseDestroy = resolve;
    });
    const windows = windowsPort({
      createForTransfer: vi.fn(async () => {
        listed.push({ focused: false, id: "w-new", recordId: "record-new" });
        return { recordId: "record-new", windowId: "w-new" };
      }),
      destroyForTransfer: vi.fn(async () => {
        await destroyGate;
      }),
      list: () => listed,
    });
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
    expect(speculative.hiddenIds().has("w-new")).toBe(true);
    expect(speculative.take("t1")).toBeNull();
    releaseDestroy();
    await vi.waitFor(() =>
      expect(speculative.hiddenIds().has("w-new")).toBe(false)
    );
  });

  it("hiddenIds keeps a window if destroyForTransfer fails", async () => {
    const listed: Array<{ focused: boolean; id: string; recordId: string }> = [
      { focused: true, id: "main", recordId: "record-main" },
    ];
    const windows = windowsPort({
      createForTransfer: vi.fn(async () => {
        listed.push({ focused: false, id: "w-new", recordId: "record-new" });
        return { recordId: "record-new", windowId: "w-new" };
      }),
      destroyForTransfer: vi.fn(async () => {
        throw new Error("destroy failed");
      }),
      list: () => listed,
    });
    const speculative = createSpeculativeTransferWindow({
      geometry: geometry(),
      windows,
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      speculative.ensure("t1", "main");
      await speculative.awaitReady("t1");
      speculative.discard("t1");
      await vi.waitFor(() =>
        expect(windows.destroyForTransfer).toHaveBeenCalledOnce()
      );
      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      expect(speculative.hiddenIds().has("w-new")).toBe(true);
    } finally {
      error.mockRestore();
    }
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

  it("materialize sets bounds while hidden, reveals, then sets bounds again", async () => {
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
    expect(windows.createForTransfer).toHaveBeenCalledOnce();
    expect(windows.setBounds).toHaveBeenCalledTimes(2);
    expect(windows.revealHost).toHaveBeenCalledOnce();
    const revealOrder = windows.revealHost.mock.invocationCallOrder[0] ?? 0;
    const firstBounds = windows.setBounds.mock.invocationCallOrder[0] ?? 0;
    const secondBounds = windows.setBounds.mock.invocationCallOrder[1] ?? 0;
    expect(firstBounds).toBeLessThan(revealOrder);
    expect(revealOrder).toBeLessThan(secondBounds);
  });

  it("take path sets bounds before and after revealHost", async () => {
    const windows = windowsPort();
    const speculative = createSpeculativeTransferWindow({
      geometry: geometry(),
      windows,
    });
    speculative.ensure("t1", "main");
    await speculative.awaitReady("t1");
    const created = await materializeInternalTransferWindow({
      geometry: geometry(),
      lease: { token: Symbol("lease") },
      sourceWindowId: "main",
      speculative,
      transferId: "t1",
      windows,
    });
    expect(created.windowId).toBe("w-new");
    expect(windows.createForTransfer).toHaveBeenCalledOnce();
    expect(windows.setBounds).toHaveBeenCalledTimes(2);
    const revealOrder = windows.revealHost.mock.invocationCallOrder[0] ?? 0;
    const firstBounds = windows.setBounds.mock.invocationCallOrder[0] ?? 0;
    const secondBounds = windows.setBounds.mock.invocationCallOrder[1] ?? 0;
    expect(firstBounds).toBeLessThan(revealOrder);
    expect(revealOrder).toBeLessThan(secondBounds);
  });
});

describe("computeTransferNewWindowBounds", () => {
  it("fits the new window inside the display work area under the cursor", () => {
    const bounds = computeTransferNewWindowBounds(
      geometry({
        getCursorScreenPoint: () => ({ x: 2100, y: 200 }),
        getDisplayWorkAreaNear: () => ({
          height: 800,
          width: 1280,
          x: 1920,
          y: 0,
        }),
        getWindowBounds: () => ({ height: 1440, width: 2560, x: 0, y: 0 }),
      }),
      "main"
    );
    expect(bounds.width).toBe(1280);
    expect(bounds.height).toBe(800);
    expect(bounds.x).toBeGreaterThanOrEqual(1920);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920 + 1280);
  });
});
