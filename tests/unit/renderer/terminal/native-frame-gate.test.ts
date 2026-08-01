import { describe, expect, it } from "vitest";
import {
  allocateTerminalPresentationId,
  TerminalNativeFrameGate,
} from "@/panel-kits/terminal/native-frame-gate.ts";

describe("TerminalNativeFrameGate", () => {
  it("allocates reload-safe JavaScript integer lifecycle identifiers", () => {
    const ids = Array.from({ length: 1000 }, () =>
      allocateTerminalPresentationId()
    );

    expect(ids.every(Number.isSafeInteger)).toBe(true);
    expect(ids.every((id) => id > 0)).toBe(true);
    expect(new Set(ids)).toHaveLength(ids.length);
  });

  it("does not become ready when native creation finishes without a frame commit", () => {
    const gate = new TerminalNativeFrameGate("terminal-1", 17);

    expect(gate.markCreated()).toBe(false);
    expect(gate.isReady).toBe(false);
  });

  it("ignores a frame commit from another lifecycle", () => {
    const gate = new TerminalNativeFrameGate("terminal-1", 17);
    gate.markCreated();

    expect(
      gate.acceptFrame({
        drawSequence: 3,
        panelId: "terminal-1",
        pixelHeight: 600,
        pixelWidth: 900,
        presentationId: 16,
        requestSequence: 2,
        surfaceGeneration: 4,
      })
    ).toBe(false);
    expect(gate.isReady).toBe(false);
  });

  it("buffers a matching frame that commits before create IPC resolves", () => {
    const gate = new TerminalNativeFrameGate("terminal-1", 17);

    expect(
      gate.acceptFrame({
        drawSequence: 3,
        panelId: "terminal-1",
        pixelHeight: 600,
        pixelWidth: 900,
        presentationId: 17,
        requestSequence: 2,
        surfaceGeneration: 4,
      })
    ).toBe(false);
    expect(gate.markCreated()).toBe(true);
    expect(gate.isReady).toBe(true);
  });
});
