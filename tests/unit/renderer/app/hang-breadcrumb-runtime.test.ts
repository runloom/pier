import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetHangBreadcrumbRuntimeForTests,
  installHangBreadcrumbRuntime,
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

  it("keeps heartbeats free of renderer-side memory claims", () => {
    // `performance.memory.usedJSHeapSize` 在未开启 --enable-precise-memory-info
    // 时是恒定占位值，据此报「内存没涨」会误导复盘。真实内存由 main 侧补。
    vi.useFakeTimers();
    installHangBreadcrumbRuntime();
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);

    const heartbeats = readLocalHangBreadcrumbs().filter(
      (crumb) => crumb.kind === "heartbeat"
    );
    expect(heartbeats.map((crumb) => crumb.detail)).toEqual([
      "alive-1",
      "alive-2",
    ]);
  });

  it("disposes the long-task observer with the runtime", () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    class FakePerformanceObserver {
      disconnect = disconnect;
      observe = observe;
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    try {
      const dispose = installHangBreadcrumbRuntime();
      expect(observe).toHaveBeenCalledWith({ entryTypes: ["longtask"] });
      dispose();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("flushes long-task crumbs immediately so the next blocking task cannot strand them", () => {
    vi.useFakeTimers();
    noteHangBreadcrumb({
      kind: "longtask",
      phase: "state",
      detail: "longtask 4100ms start 88231",
    });
    expect(hangBreadcrumb).toHaveBeenCalledTimes(1);
    const payload = hangBreadcrumb.mock.calls[0]?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        detail: "longtask 4100ms start 88231",
        kind: "longtask",
      })
    );
  });

  it("flushes worker failure marks immediately so a following hang cannot strand them", () => {
    vi.useFakeTimers();
    noteHangBreadcrumb({
      kind: "mark",
      phase: "state",
      detail: "diff-worker-unavailable: worker-error",
    });
    expect(hangBreadcrumb).toHaveBeenCalledTimes(1);
    const payload = hangBreadcrumb.mock.calls[0]?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        detail: "diff-worker-unavailable: worker-error",
        kind: "mark",
      })
    );
  });
});
