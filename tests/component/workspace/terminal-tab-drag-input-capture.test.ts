import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachWorkspaceTerminalTabDragInputCapture } from "@/components/workspace/terminal-tab-drag-input-capture.ts";
import {
  readTerminalInputRoutingTraceSnapshot,
  resetTerminalInputRoutingTraceForTests,
} from "@/lib/terminal-debug/input-routing-trace.ts";
import {
  getTerminalFocusRoutingDebugSnapshot,
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";

type Listener<T> = (event: T) => void;

function createDockviewApi() {
  let didDrop: Listener<unknown> | null = null;
  let willDragPanel: Listener<{ panel: { id: string } }> | null = null;
  let willDrop: Listener<unknown> | null = null;
  const didDropDispose = vi.fn();
  const willDragPanelDispose = vi.fn();
  const willDropDispose = vi.fn();

  return {
    api: {
      onDidDrop: vi.fn((listener: Listener<unknown>) => {
        didDrop = listener;
        return { dispose: didDropDispose };
      }),
      onWillDragPanel: vi.fn(
        (listener: Listener<{ panel: { id: string } }>) => {
          willDragPanel = listener;
          return { dispose: willDragPanelDispose };
        }
      ),
      onWillDrop: vi.fn((listener: Listener<unknown>) => {
        willDrop = listener;
        return { dispose: willDropDispose };
      }),
    } as unknown as Pick<
      DockviewApi,
      "onDidDrop" | "onWillDragPanel" | "onWillDrop"
    >,
    emitDidDrop: () => didDrop?.({}),
    emitWillDragPanel: (panelId: string) =>
      willDragPanel?.({ panel: { id: panelId } }),
    emitWillDrop: () => willDrop?.({}),
    expectListeners: () => {
      if (!(didDrop && willDragPanel && willDrop)) {
        throw new Error("Dockview listeners were not installed");
      }
    },
    spies: { didDropDispose, willDragPanelDispose, willDropDispose },
  };
}

function dragOwnerIds(): string[] {
  return getTerminalFocusRoutingDebugSnapshot().webRequestIds.filter((id) =>
    id.startsWith("dockview-tab-drag:")
  );
}

describe("workspace terminal tab drag input capture", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    resetTerminalInputRoutingTraceForTests();
    setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyHostSnapshot: vi.fn() },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "pier");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("releases a source capture exactly once after a local Dockview willDrop", async () => {
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);
    dockview.expectListeners();

    dockview.emitWillDragPanel("terminal-2");
    expect(dragOwnerIds()).toHaveLength(1);

    dockview.emitWillDrop();
    await Promise.resolve();
    dockview.emitDidDrop();
    window.dispatchEvent(new Event("dragend"));
    window.dispatchEvent(new Event("dragend"));

    expect(dragOwnerIds()).toEqual([]);
    const events = readTerminalInputRoutingTraceSnapshot().events.filter(
      (event) => event.source === "workspace-tab-drag"
    );
    expect(events).toHaveLength(2);
    expect(events.filter((event) => event.action === "ended")).toEqual([
      expect.objectContaining({
        panelId: "terminal-2",
        reason: "dockview-will-drop",
      }),
    ]);

    detach();
  });

  it("keeps onDidDrop as an additional completion signal for external payloads", async () => {
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitWillDragPanel("terminal-2");
    dockview.emitDidDrop();
    await Promise.resolve();

    expect(dragOwnerIds()).toEqual([]);
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "ended",
        reason: "dockview-did-drop",
        source: "workspace-tab-drag",
      })
    );

    detach();
  });

  it("uses source dragend to release a cancelled or cross-window source drag", () => {
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitWillDragPanel("terminal-2");
    window.dispatchEvent(new Event("dragend"));

    expect(dragOwnerIds()).toEqual([]);
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "ended",
        reason: "window-dragend",
        source: "workspace-tab-drag",
      })
    );

    detach();
  });

  it("does not release a target window's independent Web owner when it did not start the drag", async () => {
    const releaseDialog = requestTerminalWebFocus("dialog");
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitDidDrop();
    await Promise.resolve();

    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "dialog",
    ]);

    releaseDialog();
    detach();
  });

  it("keeps another durable owner while releasing only the tab drag owner", () => {
    const releaseDialog = requestTerminalWebFocus("dialog");
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitWillDragPanel("terminal-2");
    window.dispatchEvent(new Event("dragend"));

    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "dialog",
    ]);

    releaseDialog();
    detach();
  });

  it("ends an active drag on Escape without waiting for the fallback", () => {
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitWillDragPanel("terminal-2");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(dragOwnerIds()).toEqual([]);
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({ action: "ended", reason: "escape" })
    );

    detach();
  });

  it("supersedes a stale session when a new drag starts before it ended", () => {
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitWillDragPanel("terminal-2");
    dockview.emitWillDragPanel("terminal-3");

    expect(dragOwnerIds()).toEqual(["dockview-tab-drag:2"]);
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "ended",
        panelId: "terminal-2",
        reason: "superseded",
        source: "workspace-tab-drag",
      })
    );

    window.dispatchEvent(new Event("dragend"));
    expect(dragOwnerIds()).toEqual([]);

    detach();
  });

  it("recovers an orphaned drag with a recorded fallback timeout", () => {
    vi.useFakeTimers();
    const dockview = createDockviewApi();
    const detach = attachWorkspaceTerminalTabDragInputCapture(dockview.api);

    dockview.emitWillDragPanel("terminal-2");
    vi.advanceTimersByTime(5000);

    expect(dragOwnerIds()).toEqual([]);
    expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
      expect.objectContaining({
        action: "fallback-timeout",
        reason: "fallback-timeout",
        source: "workspace-tab-drag",
      })
    );

    detach();
  });
});
