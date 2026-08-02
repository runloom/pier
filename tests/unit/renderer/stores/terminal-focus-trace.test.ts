import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatTerminalFocusTraceDump,
  getTerminalFocusTraceEvents,
  resetTerminalFocusTraceForTests,
} from "@/lib/workspace/terminal-focus-trace.ts";
import {
  clearTransientWebClickFocus,
  getTerminalFocusRoutingDebugSnapshot,
  requestTerminalFocusIntent,
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";

describe("terminal focus trace (minimal)", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          applyHostSnapshot: vi.fn(),
        },
      },
    });
  });

  it("exposes webRequestIds and records add/remove", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "term-1" });
    const release = requestTerminalWebFocus("settings-dialog");
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([
      "settings-dialog",
    ]);
    release();
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([]);
    const kinds = getTerminalFocusTraceEvents().map((event) => event.kind);
    expect(kinds).toContain("add");
    expect(kinds).toContain("remove");
    expect(kinds).toContain("flip");
  });

  it("flags sticky pier.click when base is terminal", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "term-1" });
    requestTerminalWebFocus("pier.click");
    expect(
      getTerminalFocusTraceEvents().some((event) => event.kind === "sticky")
    ).toBe(true);
  });

  it("intent clears pier.click and dumps include ids", () => {
    setTerminalBasePanel({ kind: "terminal", panelId: "term-1" });
    requestTerminalWebFocus("pier.click");
    requestTerminalFocusIntent("term-1");
    expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).toEqual([]);
    const dump = formatTerminalFocusTraceDump(
      getTerminalFocusRoutingDebugSnapshot()
    );
    expect(dump).toContain("webRequestIds");
    expect(dump).toContain("term-1");
  });

  it("clearTransient records remove", () => {
    requestTerminalWebFocus("pier.click");
    clearTransientWebClickFocus();
    expect(
      getTerminalFocusTraceEvents().some(
        (event) => event.kind === "remove" && event.detail === "pier.click"
      )
    ).toBe(true);
  });

  it("reset clears the ring", () => {
    requestTerminalWebFocus("a");
    expect(getTerminalFocusTraceEvents().length).toBeGreaterThan(0);
    resetTerminalFocusTraceForTests();
    expect(getTerminalFocusTraceEvents()).toHaveLength(0);
  });
});
