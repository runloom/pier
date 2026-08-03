import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHANNEL = "pier://terminal:input-routing-diagnostic";

describe("terminal input-routing diagnostics IPC", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetDefaultLogSinkForTests } = await import("@shared/logger.ts");
    resetDefaultLogSinkForTests();
    vi.clearAllMocks();
  });

  async function setupHarness(options?: { knownSender?: boolean }) {
    vi.resetModules();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const sender = { id: 91 };
    const win = {
      id: 7,
      webContents: sender,
    };
    const records: Array<{
      ctx?: Record<string, unknown>;
      level: string;
      scope?: string;
    }> = [];
    const { setDefaultLogSink } = await import("@shared/logger.ts");
    setDefaultLogSink((record) => records.push(record));
    vi.doMock("@main/windows/identity.ts", () => ({
      findAppWindowByWebContents: vi.fn((candidate: unknown) =>
        options?.knownSender === false || candidate !== sender ? null : win
      ),
    }));
    vi.doMock("@main/ipc/terminal/window-scope.ts", () => ({
      stableWindowIdFor: vi.fn(() => "main"),
    }));

    const { registerTerminalInputRoutingDiagnosticsIpc } = await import(
      "@main/ipc/terminal/input-routing-diagnostics.ts"
    );
    registerTerminalInputRoutingDiagnosticsIpc({
      on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    } as never);

    return { handlers, records, sender };
  }

  it("writes a validated event with main-owned window identity", async () => {
    const { handlers, records, sender } = await setupHarness();

    handlers.get(CHANNEL)?.(
      { sender },
      {
        action: "ended",
        panelId: "terminal-1",
        reason: "window-dragend",
        sessionId: "dockview-tab-drag:1",
        source: "workspace-tab-drag",
      }
    );

    expect(records).toEqual([
      expect.objectContaining({
        ctx: expect.objectContaining({
          browserWindowId: 7,
          panelId: "terminal-1",
          windowId: "main",
        }),
        level: "info",
        scope: "terminal.input-routing",
      }),
    ]);
  });

  it("drops invalid payloads and unknown senders without an info record", async () => {
    const invalid = await setupHarness();
    invalid.handlers.get(CHANNEL)?.(
      { sender: invalid.sender },
      {
        action: "dispatched",
        commandId: "pier.commandPalette.open",
        key: "Meta+Shift+P",
        overlayCount: 0,
        route: "web-keydown",
        source: "keybinding",
      }
    );

    expect(invalid.records.some((record) => record.level === "info")).toBe(
      false
    );
    expect(invalid.records).toContainEqual(
      expect.objectContaining({
        level: "warn",
        scope: "terminal.input-routing",
      })
    );

    const unknown = await setupHarness({ knownSender: false });
    unknown.handlers.get(CHANNEL)?.(
      { sender: unknown.sender },
      {
        action: "started",
        sessionId: "dockview-tab-drag:1",
        source: "workspace-tab-drag",
      }
    );

    expect(unknown.records.some((record) => record.level === "info")).toBe(
      false
    );
  });

  it("names the stuck owner in a warning so the log alone identifies it", async () => {
    const { handlers, records, sender } = await setupHarness();

    handlers.get(CHANNEL)?.(
      { sender },
      {
        action: "owner-stuck",
        basePanelKind: "terminal",
        effectiveKind: "web",
        heldMs: 130_000,
        ownerIds: ["dockview-sash-drag:3", "pier.click"],
        source: "input-owner-watch",
        stuckOwnerId: "dockview-sash-drag:3",
      }
    );

    expect(records).toEqual([
      expect.objectContaining({
        ctx: expect.objectContaining({
          browserWindowId: 7,
          ownerIds: ["dockview-sash-drag:3", "pier.click"],
          stuckOwnerId: "dockview-sash-drag:3",
        }),
        level: "warn",
        scope: "terminal.input-routing",
      }),
    ]);
  });

  it("writes a drag fallback as a warning for direct investigation", async () => {
    const { handlers, records, sender } = await setupHarness();

    handlers.get(CHANNEL)?.(
      { sender },
      {
        action: "fallback-timeout",
        panelId: "terminal-1",
        reason: "fallback-timeout",
        sessionId: "dockview-tab-drag:1",
        source: "workspace-tab-drag",
      }
    );

    expect(records).toEqual([
      expect.objectContaining({
        ctx: expect.objectContaining({
          action: "fallback-timeout",
          panelId: "terminal-1",
          windowId: "main",
        }),
        level: "warn",
        scope: "terminal.input-routing",
      }),
    ]);
  });
});
