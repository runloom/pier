import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTerminalInputRoutingTraceSnapshot,
  resetTerminalInputRoutingTraceForTests,
} from "@/lib/terminal-debug/input-routing-trace.ts";
import {
  checkTerminalWebOwnerRetention,
  resetTerminalWebOwnerRetentionWatchForTests,
} from "@/lib/terminal-debug/owner-retention-watch.ts";
import {
  getTerminalFocusRoutingDebugSnapshot,
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";

const DRAG_OWNER = "dockview-sash-drag:1";
const DURABLE_OWNER = "settings-dialog";

function stuckEvents() {
  return readTerminalInputRoutingTraceSnapshot().events.filter(
    (event) => event.source === "input-owner-watch"
  );
}

describe("terminal web owner retention watch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetTerminalInputRoutingForTests();
    resetTerminalInputRoutingTraceForTests();
    resetTerminalWebOwnerRetentionWatchForTests();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyHostSnapshot: vi.fn() },
      },
    });
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
  });

  afterEach(() => {
    resetTerminalWebOwnerRetentionWatchForTests();
    Reflect.deleteProperty(window, "pier");
    vi.useRealTimers();
  });

  it("names a drag owner that outlived its gesture exactly once", () => {
    requestTerminalWebFocus(DRAG_OWNER);
    checkTerminalWebOwnerRetention();
    expect(stuckEvents()).toEqual([]);

    vi.setSystemTime(20_000);
    checkTerminalWebOwnerRetention();
    checkTerminalWebOwnerRetention();

    expect(stuckEvents()).toEqual([
      expect.objectContaining({
        action: "owner-stuck",
        basePanelKind: "terminal",
        effectiveKind: "web",
        ownerIds: [DRAG_OWNER],
        source: "input-owner-watch",
        stuckOwnerId: DRAG_OWNER,
      }),
    ]);
  });

  it("holds durable owners to a much longer threshold", () => {
    requestTerminalWebFocus(DURABLE_OWNER);
    checkTerminalWebOwnerRetention();

    vi.setSystemTime(20_000);
    checkTerminalWebOwnerRetention();
    expect(stuckEvents()).toEqual([]);

    vi.setSystemTime(130_000);
    checkTerminalWebOwnerRetention();
    expect(stuckEvents()).toHaveLength(1);
    expect(stuckEvents()[0]).toMatchObject({ stuckOwnerId: DURABLE_OWNER });
  });

  it("stays silent while the keyboard is not meant to be on a terminal", () => {
    setTerminalBasePanel({ kind: "web" });
    requestTerminalWebFocus(DRAG_OWNER);

    vi.setSystemTime(20_000);
    checkTerminalWebOwnerRetention();

    expect(stuckEvents()).toEqual([]);
  });

  it("restarts the clock after an owner is released and re-acquired", () => {
    const release = requestTerminalWebFocus(DRAG_OWNER);
    checkTerminalWebOwnerRetention();
    vi.setSystemTime(20_000);
    checkTerminalWebOwnerRetention();
    expect(stuckEvents()).toHaveLength(1);

    release();
    checkTerminalWebOwnerRetention();
    requestTerminalWebFocus(DRAG_OWNER);
    checkTerminalWebOwnerRetention();
    expect(stuckEvents()).toHaveLength(1);

    vi.setSystemTime(40_000);
    checkTerminalWebOwnerRetention();
    expect(stuckEvents()).toHaveLength(2);
  });

  it("observes without releasing the owner it reports", () => {
    requestTerminalWebFocus(DRAG_OWNER);
    checkTerminalWebOwnerRetention();

    vi.setSystemTime(20_000);
    checkTerminalWebOwnerRetention();

    expect(stuckEvents()).toHaveLength(1);
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toContain(
      DRAG_OWNER
    );
  });
});
