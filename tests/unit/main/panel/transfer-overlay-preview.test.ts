import { createPanelTransferOverlayPreviewController } from "@main/services/panel-transfer/overlay-preview.ts";
import type {
  PanelTransferGeometryPort,
  PanelTransferWindowPort,
} from "@main/services/panel-transfer/types.ts";
import type { PanelTransferOverlayPreview } from "@shared/contracts/panel-transfer.ts";
import { describe, expect, it, vi } from "vitest";

const TRANSFER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function geometryWithCursor(cursor: {
  x: number;
  y: number;
}): PanelTransferGeometryPort {
  return {
    getCursorScreenPoint: () => cursor,
    getDisplayWorkAreaNear: () => ({ height: 1000, width: 1600, x: 0, y: 0 }),
    getWindowBounds: (windowId) => {
      if (windowId === "main") {
        return { height: 800, width: 1200, x: 0, y: 0 };
      }
      if (windowId === "w-1") {
        return { height: 800, width: 1200, x: 1300, y: 0 };
      }
      return null;
    },
    getWindowContentBounds: (windowId) => {
      if (windowId === "main") {
        return { height: 760, width: 1200, x: 0, y: 40 };
      }
      if (windowId === "w-1") {
        return { height: 760, width: 1200, x: 1300, y: 40 };
      }
      return null;
    },
    getWindowZOrderTopFirst: () => null,
    isLeftMouseButtonDown: () => false,
  };
}

function windowsPort(): PanelTransferWindowPort {
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
    list: () => [
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "w-1", recordId: "record-w1" },
    ],
    releaseRendererShow: vi.fn(),
    revealHost: vi.fn(),
    runExclusive: vi.fn(async (operation) =>
      operation({ token: Symbol("lease") })
    ),
    setBounds: vi.fn(),
  };
}

function manualSchedule() {
  let callback: (() => void) | null = null;
  return {
    schedule: {
      interval(cb: () => void) {
        callback = cb;
        return {
          dispose() {
            callback = null;
          },
        };
      },
    },
    tick() {
      callback?.();
    },
  };
}

describe("panel transfer overlay preview controller", () => {
  it("emits source, then clear outside, then target client point, then clear on stop", () => {
    const cursor = { x: 100, y: 80 };
    const broadcasts: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: (preview) => {
        broadcasts.push(preview);
      },
      geometry: geometryWithCursor(cursor),
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });

    controller.start(TRANSFER_ID, "main");
    expect(broadcasts).toEqual([
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
    ]);

    cursor.x = 4000;
    cursor.y = 80;
    scheduled.tick();
    expect(broadcasts.at(-1)).toEqual({
      kind: "outside",
      transferId: TRANSFER_ID,
    });

    cursor.x = 1400;
    cursor.y = 80;
    scheduled.tick();
    expect(broadcasts.at(-1)).toEqual({
      clientX: 100,
      clientY: 40,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });

    const beforeStop = broadcasts.length;
    scheduled.tick();
    expect(broadcasts).toHaveLength(beforeStop);

    controller.seal(TRANSFER_ID);
    expect(broadcasts.at(-1)).toEqual({
      kind: "clear",
      transferId: TRANSFER_ID,
    });
  });

  it("quantizes target points so sub-pixel motion does not rebroadcast", () => {
    const cursor = { x: 1400, y: 80 };
    const broadcasts: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: (preview) => {
        broadcasts.push(preview);
      },
      geometry: geometryWithCursor(cursor),
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });

    controller.start(TRANSFER_ID, "main");
    expect(broadcasts).toHaveLength(1);
    cursor.x = 1401;
    scheduled.tick();
    expect(broadcasts).toHaveLength(1);
    cursor.x = 1405;
    scheduled.tick();
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[1]?.kind).toBe("target");
    controller.seal(TRANSFER_ID);
  });

  it("notifies onPreview when classification changes", () => {
    const cursor = { x: 100, y: 80 };
    const previews: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: () => undefined,
      geometry: geometryWithCursor(cursor),
      onPreview: (preview) => {
        previews.push(preview);
      },
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });
    controller.start(TRANSFER_ID, "main");
    expect(previews.at(-1)?.kind).toBe("source");
    cursor.x = 4000;
    scheduled.tick();
    expect(previews.at(-1)?.kind).toBe("outside");
    controller.seal(TRANSFER_ID);
  });

  it("clears the previous transfer when a new offer starts", () => {
    const cursor = { x: 100, y: 80 };
    const broadcasts: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: (preview) => {
        broadcasts.push(preview);
      },
      geometry: geometryWithCursor(cursor),
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });
    const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    controller.start(TRANSFER_ID, "main");
    controller.start(nextId, "main");
    expect(broadcasts).toEqual([
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
      { kind: "clear", transferId: TRANSFER_ID },
      { kind: "source", transferId: nextId, windowId: "main" },
    ]);
    controller.seal(nextId);
  });

  it("starting a new transfer seals the previous id so it cannot restart", () => {
    const cursor = { x: 100, y: 80 };
    const broadcasts: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: (preview) => {
        broadcasts.push(preview);
      },
      geometry: geometryWithCursor(cursor),
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });
    const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    controller.start(TRANSFER_ID, "main");
    controller.start(nextId, "main");
    const afterNext = broadcasts.length;
    controller.start(TRANSFER_ID, "main");
    scheduled.tick();
    expect(broadcasts).toHaveLength(afterNext);
    expect(
      broadcasts.filter((preview) => preview.transferId === TRANSFER_ID)
    ).toEqual([
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
      { kind: "clear", transferId: TRANSFER_ID },
    ]);
    controller.seal(nextId);
  });

  it("seal emits clear and ignores later start of the same transfer", () => {
    const cursor = { x: 100, y: 80 };
    const broadcasts: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: (preview) => {
        broadcasts.push(preview);
      },
      geometry: geometryWithCursor(cursor),
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });

    controller.start(TRANSFER_ID, "main");
    expect(broadcasts).toEqual([
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
    ]);
    controller.seal(TRANSFER_ID);
    expect(broadcasts.at(-1)).toEqual({
      kind: "clear",
      transferId: TRANSFER_ID,
    });
    const afterSeal = broadcasts.length;
    controller.start(TRANSFER_ID, "main");
    scheduled.tick();
    expect(broadcasts).toHaveLength(afterSeal);
    expect(
      broadcasts.filter((preview) => preview.kind === "source")
    ).toHaveLength(1);
  });

  it("seal before any start still blocks a late start", () => {
    const cursor = { x: 100, y: 80 };
    const broadcasts: PanelTransferOverlayPreview[] = [];
    const scheduled = manualSchedule();
    const controller = createPanelTransferOverlayPreviewController({
      broadcast: (preview) => {
        broadcasts.push(preview);
      },
      geometry: geometryWithCursor(cursor),
      schedule: scheduled.schedule,
      windows: windowsPort(),
    });

    controller.seal(TRANSFER_ID);
    expect(broadcasts).toEqual([{ kind: "clear", transferId: TRANSFER_ID }]);
    controller.start(TRANSFER_ID, "main");
    scheduled.tick();
    expect(broadcasts).toEqual([{ kind: "clear", transferId: TRANSFER_ID }]);
  });
});
