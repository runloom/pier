import { terminalInputRoutingDiagnosticSchema } from "@shared/contracts/terminal/input-routing-diagnostics.ts";
import { describe, expect, it } from "vitest";

describe("terminal input-routing diagnostic schema", () => {
  it("accepts a bounded tab-drag lifecycle event", () => {
    const parsed = terminalInputRoutingDiagnosticSchema.safeParse({
      action: "ended",
      elapsedMs: 42,
      panelId: "terminal-1",
      reason: "window-dragend",
      sessionId: "dockview-tab-drag:1",
      source: "workspace-tab-drag",
      webOwnerCount: 0,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts sash sessions and stuck-owner reports", () => {
    expect(
      terminalInputRoutingDiagnosticSchema.safeParse({
        action: "ended",
        elapsedMs: 900,
        reason: "window-blur",
        sessionId: "dockview-sash-drag:2",
        source: "workspace-sash-drag",
        webOwnerCount: 1,
      }).success
    ).toBe(true);
    expect(
      terminalInputRoutingDiagnosticSchema.safeParse({
        action: "owner-stuck",
        basePanelKind: "terminal",
        effectiveKind: "web",
        heldMs: 130_000,
        ownerIds: ["dockview-sash-drag:2"],
        source: "input-owner-watch",
        stuckOwnerId: "dockview-sash-drag:2",
      }).success
    ).toBe(true);
  });

  it("rejects drop reasons that do not belong to the sash pointer session", () => {
    expect(
      terminalInputRoutingDiagnosticSchema.safeParse({
        action: "ended",
        reason: "dockview-will-drop",
        sessionId: "dockview-sash-drag:2",
        source: "workspace-sash-drag",
      }).success
    ).toBe(false);
  });

  it("rejects raw key material and oversized session ids", () => {
    expect(
      terminalInputRoutingDiagnosticSchema.safeParse({
        action: "dispatched",
        commandId: "pier.commandPalette.open",
        key: "Meta+Shift+P",
        overlayCount: 0,
        route: "web-keydown",
        source: "keybinding",
      }).success
    ).toBe(false);
    expect(
      terminalInputRoutingDiagnosticSchema.safeParse({
        action: "started",
        sessionId: "x".repeat(97),
        source: "workspace-tab-drag",
      }).success
    ).toBe(false);
  });
});
