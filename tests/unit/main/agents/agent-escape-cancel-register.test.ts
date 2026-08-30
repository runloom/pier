import type {
  ActivityStatus,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
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

function agentActivity(status: ActivityStatus | undefined): ForegroundActivity {
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

function snapshotPayload(activities: ForegroundActivity[]) {
  return {
    activities,
    ts: Date.now(),
    version: 1,
  };
}

type EscapeCallback = (browserWindowId: number, nativePanelId: string) => void;

describe("registerTerminalAgentEscapeCancel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("busy agent → ingest TurnInterrupted with authoritative stop", () => {
    const held: { callback: EscapeCallback | null } = { callback: null };
    const ingestAgentEvent = vi.fn(() => true);
    const snapshot = vi.fn(() =>
      snapshotPayload([agentActivity("processing")])
    );
    findAppWindowByElectronId.mockReturnValue({
      id: 7,
      isDestroyed: () => false,
    });

    registerTerminalAgentEscapeCancel({
      addon: {
        setBareEscapeForwardCallback: (cb: EscapeCallback) => {
          held.callback = cb;
        },
      } as unknown as NativeAddon,
      host: { ingestAgentEvent, snapshot },
    });

    expect(held.callback).toBeTypeOf("function");
    held.callback?.(42, "7::terminal-1");

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
        evidenceSource: "host",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      }
    );
  });

  it("ready/waiting/shell 与 destroyed window 不 ingest", () => {
    const held: { callback: EscapeCallback | null } = { callback: null };
    const ingestAgentEvent = vi.fn(() => true);
    const snapshot = vi.fn(() => snapshotPayload([agentActivity("ready")]));
    findAppWindowByElectronId.mockReturnValue({
      id: 7,
      isDestroyed: () => false,
    });

    registerTerminalAgentEscapeCancel({
      addon: {
        setBareEscapeForwardCallback: (cb: EscapeCallback) => {
          held.callback = cb;
        },
      } as unknown as NativeAddon,
      host: { ingestAgentEvent, snapshot },
    });

    held.callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();

    snapshot.mockReturnValue(snapshotPayload([agentActivity("waiting")]));
    held.callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();

    snapshot.mockReturnValue(
      snapshotPayload([
        {
          kind: "shell",
          panelId: "terminal-1",
          spawnedAt: 1,
          updatedAt: 2,
          windowId: "1",
        },
      ])
    );
    held.callback?.(42, "7::terminal-1");
    expect(ingestAgentEvent).not.toHaveBeenCalled();

    findAppWindowByElectronId.mockReturnValue({
      id: 7,
      isDestroyed: () => true,
    });
    snapshot.mockReturnValue(snapshotPayload([agentActivity("processing")]));
    held.callback?.(42, "7::terminal-1");
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
      addon: {
        setBareEscapeForwardCallback: undefined,
      } as unknown as NativeAddon,
      host,
    });
    expect(host.ingestAgentEvent).not.toHaveBeenCalled();
  });
});
