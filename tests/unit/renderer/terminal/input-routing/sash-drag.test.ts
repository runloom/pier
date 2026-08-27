import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTerminalInputRoutingTraceSnapshot,
  resetTerminalInputRoutingTraceForTests,
} from "@/lib/terminal-debug/input-routing-trace.ts";
import { resetTerminalSurfaceSuppressionForTests } from "@/panel-kits/terminal/layout-coordinator.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import {
  installTerminalInputRoutingSashDragWatcher,
  resetTerminalInputRoutingSashDragForTests,
} from "@/stores/terminal-input-routing-drag.ts";
import {
  getTerminalFocusRoutingDebugSnapshot,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";

const CLEANUP_KEY = "__pierTerminalInputRoutingSashDragCleanup__";

function sashEvents() {
  return readTerminalInputRoutingTraceSnapshot().events.filter(
    (event) => event.source === "workspace-sash-drag"
  );
}

function sashOwnerIds(): string[] {
  return getTerminalFocusRoutingDebugSnapshot().webRequestIds.filter((id) =>
    id.startsWith("dockview-sash-drag")
  );
}

function pressSash(): HTMLElement {
  const sash = document.createElement("div");
  sash.className = "dv-sash";
  document.body.append(sash);
  sash.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true })
  );
  return sash;
}

describe("terminal input-routing sash drag trace", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    resetTerminalInputRoutingTraceForTests();
    resetTerminalInputRoutingSashDragForTests();
    resetTerminalSurfaceSuppressionForTests();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyHostSnapshot: vi.fn() },
      },
    });
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    installTerminalInputRoutingSashDragWatcher();
  });

  afterEach(() => {
    (document as Document & { [CLEANUP_KEY]?: () => void })[CLEANUP_KEY]?.();
    resetTerminalInputRoutingSashDragForTests();
    resetTerminalSurfaceSuppressionForTests();
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "pier");
  });

  it("pairs a sash session and releases its own owner on pointerup", () => {
    pressSash();

    expect(sashOwnerIds()).toEqual(["dockview-sash-drag:1"]);
    expect(sashEvents()).toEqual([
      expect.objectContaining({
        action: "started",
        sessionId: "dockview-sash-drag:1",
        source: "workspace-sash-drag",
      }),
    ]);

    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(sashOwnerIds()).toEqual([]);
    expect(sashEvents().at(-1)).toMatchObject({
      action: "ended",
      reason: "pointerup",
      sessionId: "dockview-sash-drag:1",
    });
  });

  it("distinguishes pointercancel and blur endings", () => {
    pressSash();
    window.dispatchEvent(new PointerEvent("pointercancel"));
    expect(sashEvents().at(-1)).toMatchObject({ reason: "pointercancel" });

    pressSash();
    window.dispatchEvent(new Event("blur"));

    expect(sashOwnerIds()).toEqual([]);
    expect(sashEvents().at(-1)).toMatchObject({
      reason: "window-blur",
      sessionId: "dockview-sash-drag:2",
    });
  });

  it("records a disposed session when the watcher is torn down mid-drag", () => {
    pressSash();

    (document as Document & { [CLEANUP_KEY]?: () => void })[CLEANUP_KEY]?.();

    expect(sashOwnerIds()).toEqual([]);
    expect(sashEvents().at(-1)).toMatchObject({
      action: "disposed",
      reason: "dispose",
    });
  });

  it("keeps session ids unique so a leaked owner names its own session", () => {
    pressSash();
    window.dispatchEvent(new PointerEvent("pointerup"));
    pressSash();

    expect(sashOwnerIds()).toEqual(["dockview-sash-drag:2"]);
  });

  it("suppresses native terminal surfaces for the sash drag session", () => {
    pressSash();
    expect(useTerminalStore.getState().suppressTerminals).toBe(true);
    expect(useTerminalStore.getState().placeholderVisible).toBe(true);

    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(useTerminalStore.getState().suppressTerminals).toBe(false);
  });
});
