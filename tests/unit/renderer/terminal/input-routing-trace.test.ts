import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTerminalInputRoutingTraceSnapshot,
  recordTerminalInputRoutingTrace,
  resetTerminalInputRoutingTraceForTests,
} from "@/lib/terminal-debug/input-routing-trace.ts";

describe("terminal input-routing trace", () => {
  beforeEach(() => {
    resetTerminalInputRoutingTraceForTests();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "pier");
  });

  it("records ordered drag and command decisions without raw keyboard data", () => {
    recordTerminalInputRoutingTrace({
      action: "started",
      panelId: "terminal-1",
      sessionId: "dockview-tab-drag:1",
      source: "workspace-tab-drag",
    });
    recordTerminalInputRoutingTrace({
      action: "dispatched",
      commandId: "pier.commandPalette.open",
      overlayCount: 0,
      route: "web-keydown",
      source: "keybinding",
    });

    const events = readTerminalInputRoutingTraceSnapshot().events;

    expect(events).toEqual([
      expect.objectContaining({
        action: "started",
        panelId: "terminal-1",
        seq: 1,
        source: "workspace-tab-drag",
      }),
      expect.objectContaining({
        action: "dispatched",
        commandId: "pier.commandPalette.open",
        route: "web-keydown",
        seq: 2,
        source: "keybinding",
      }),
    ]);
    expect(events.every((event) => !("chars" in event))).toBe(true);
    expect(events.every((event) => !("key" in event))).toBe(true);
    expect(events.every((event) => !("text" in event))).toBe(true);
  });

  it("drops the oldest event when the diagnostic ring reaches its limit", () => {
    for (let index = 0; index < 81; index += 1) {
      recordTerminalInputRoutingTrace({
        action: "started",
        sessionId: `dockview-tab-drag:${index}`,
        source: "workspace-tab-drag",
      });
    }

    const events = readTerminalInputRoutingTraceSnapshot().events;

    expect(events).toHaveLength(80);
    expect(events[0]).toMatchObject({
      seq: 2,
      sessionId: "dockview-tab-drag:1",
    });
    expect(events.at(-1)).toMatchObject({
      seq: 81,
      sessionId: "dockview-tab-drag:80",
    });
  });

  it("forwards the allowlisted diagnostic payload to the terminal facade", () => {
    const recordInputRoutingDiagnostic = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: { recordInputRoutingDiagnostic },
      },
    });

    recordTerminalInputRoutingTrace({
      action: "ended",
      panelId: "terminal-1",
      reason: "window-dragend",
      sessionId: "dockview-tab-drag:1",
      source: "workspace-tab-drag",
    });

    expect(recordInputRoutingDiagnostic).toHaveBeenCalledWith({
      action: "ended",
      panelId: "terminal-1",
      reason: "window-dragend",
      sessionId: "dockview-tab-drag:1",
      source: "workspace-tab-drag",
    });
  });
});
