import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetHangBreadcrumbRuntimeForTests,
  noteHangBreadcrumb,
  readLocalHangBreadcrumbs,
} from "@/lib/diagnostics/hang-breadcrumb.ts";

describe("hang breadcrumb runtime (renderer)", () => {
  const hangBreadcrumb = vi.fn();

  beforeEach(() => {
    __resetHangBreadcrumbRuntimeForTests();
    hangBreadcrumb.mockReset();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { diagnostics: { hangBreadcrumb } },
    });
  });

  afterEach(() => {
    __resetHangBreadcrumbRuntimeForTests();
    vi.useRealTimers();
  });

  it("dedupes consecutive identical crumbs and batches flush", () => {
    vi.useFakeTimers();
    noteHangBreadcrumb({
      kind: "panel-activate",
      phase: "state",
      activePanelComponent: "terminal",
      panelId: "terminal-1",
    });
    noteHangBreadcrumb({
      kind: "panel-activate",
      phase: "state",
      activePanelComponent: "terminal",
      panelId: "terminal-1",
    });
    expect(readLocalHangBreadcrumbs()).toHaveLength(1);
    expect(hangBreadcrumb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(hangBreadcrumb).toHaveBeenCalledTimes(1);
    const payload = hangBreadcrumb.mock.calls[0]?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        kind: "panel-activate",
        panelId: "terminal-1",
      })
    );
  });

  it("does not consecutive-dedupe heartbeats", () => {
    vi.useFakeTimers();
    noteHangBreadcrumb({
      kind: "heartbeat",
      phase: "tick",
      detail: "alive-1",
    });
    noteHangBreadcrumb({
      kind: "heartbeat",
      phase: "tick",
      detail: "alive-2",
    });
    expect(readLocalHangBreadcrumbs()).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(hangBreadcrumb).toHaveBeenCalled();
    const payload = hangBreadcrumb.mock.calls[0]?.[0];
    expect(Array.isArray(payload) ? payload : [payload]).toHaveLength(2);
  });

  it("flushes panel-close and command immediately without waiting for the timer", () => {
    vi.useFakeTimers();
    noteHangBreadcrumb({
      kind: "panel-close",
      phase: "start",
      commandId: "pier.panel.closeActive",
      detail: "closeActive",
    });
    expect(hangBreadcrumb).toHaveBeenCalledTimes(1);
    hangBreadcrumb.mockClear();
    noteHangBreadcrumb({
      kind: "command",
      phase: "start",
      commandId: "pier.panel.closeActive",
      detail: "web-keydown",
    });
    expect(hangBreadcrumb).toHaveBeenCalledTimes(1);
  });
});
