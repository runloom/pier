import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTerminalAgentEscapeCancel } from "../../../../src/main/ipc/terminal/agent-escape-cancel.ts";
import type { NativeAddon } from "../../../../src/main/ipc/terminal/native-addon.ts";

const findAppWindowByElectronId = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/main/windows/identity.ts", () => ({
  findAppWindowByElectronId,
}));

vi.mock("../../../../src/main/ipc/terminal/debug.ts", () => ({
  recordNativeTerminalRoute: vi.fn(),
}));

vi.mock("../../../../src/main/ipc/foreground-activity.ts", () => ({
  foregroundActivityService: {
    ingestAgentEvent: vi.fn(),
    snapshot: vi.fn(),
  },
}));

function agentActivity(
  status: "processing" | "ready" | "waiting" | "tool" | "running"
): ForegroundActivity {
  return {
    agentId: "claude",
    kind: "agent",
    panelId: "terminal-1",
    source: "hook",
    spawnedAt: 1,
    status,
    subagentCount: 0,
    updatedAt: 2,
    windowId: "1",
    sessionId: "sess-1",
  };
}

describe("registerTerminalAgentEscapeCancel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("busy agent → ingest TurnInterrupted with authoritative stop", () => {
    let callback:
      | ((browserWindowId: number, nativePanelId: string) => void)
      | null = null;
    const ingestAgentEvent = vi.fn(() => true);
    const snapshot = vi.fn(() => ({
      activities: [agentActivity("processing")],
      version: 1,
    }));
    findAppWindowByElectronId.mockReturnValue({
      id: 7,
      isDestroyed: () => false,
    });

    registerTerminalAgentEscapeCancel({
      addon: {
        setBareEscapeForwardCallback: (cb) => {
          callback = cb;
        },
      } as unknown as NativeAddon,
      host: { ingestAgentEvent, snapshot },
    });

    expect(callback).toBeTypeOf("function");
    callback?.(42, "7::terminal-1");

    expect(snapshot).toHaveBeenCalledWith("7");
    expect(ingestAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude",
        event: "TurnInterrupted",
        nativeEvent: "pier.terminal.user_escape",
        panelId: "terminal-1",
        sessionId: "sess-1",
        v: 3,
        windowId: "7",
      }),
      {
        evidenceSource: "transcript",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      }
    );
  });

  it("ready/waiting/shell 与 destroyed window 不 ingest", () => {
    let callback:
      | ((browserWindowId: number, nativePanelId: string) => void)
      | null = null;
    const ingestAgentEvent = vi.fn(() => true);
    const snapshot = vi.fn(() => ({
      activities: [agentActivity("ready")],
      version: 1,
    }));
    findAppWindowByElectronId.mockReturnValue({
      id: 7,
      isDestroyed: () => false,
    });

    registerTerminalAgentEscapeCancel({
      addon: {
        setBareEscapeForwardCallback: (cb) => {
          callback = cb;
        },
      } as unknown as NativeAddon,
      host: { ingestAgentEvent, snapshot },
    });

    callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();

    snapshot.mockReturnValue({
      activities: [agentActivity("waiting")],
      version: 1,
    });
    callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();

    snapshot.mockReturnValue({
      activities: [
        {
          kind: "shell",
          panelId: "terminal-1",
          source: "command",
          spawnedAt: 1,
          updatedAt: 2,
          windowId: "1",
        },
      ],
      version: 1,
    });
    callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();

    findAppWindowByElectronId.mockReturnValue({
      id: 7,
      isDestroyed: () => true,
    });
    snapshot.mockReturnValue({
      activities: [agentActivity("processing")],
      version: 1,
    });
    callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();
  });

  it("missing setBareEscapeForwardCallback is a no-op", () => {
    const host = {
      ingestAgentEvent: vi.fn(),
      snapshot: vi.fn(),
    };
    registerTerminalAgentEscapeCancel({
      addon: {} as NativeAddon,
      host,
    });
    registerTerminalAgentEscapeCancel({
      addon: null,
      host,
    });
    expect(host.ingestAgentEvent).not.toHaveBeenCalled();
  });
});
