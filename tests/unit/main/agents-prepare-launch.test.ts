import { registerAgentsIpc } from "@main/ipc/agents.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakePreferences = { read: vi.fn() };

// agents.ts imports the concrete terminalLaunchRegistry directly (its
// register() returns string synchronously). Mock that module so we can spy on
// register() and assert it is/ isn't called per branch.
const registerSpy = vi.fn((_launch: { command: string }) => "launch-abc");

vi.mock("@main/state/terminal-launch-state.ts", () => ({
  terminalLaunchRegistry: {
    register: (launch: { command: string }) => registerSpy(launch),
  },
}));

vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    services: {
      preferences: { read: () => fakePreferences.read() },
    },
  },
}));

function makeIpcMain() {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >();
  return {
    handle(
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => Promise<unknown>
    ) {
      handlers.set(channel, fn);
    },
    async invoke(channel: string, ...args: unknown[]) {
      const fn = handlers.get(channel);
      if (!fn) {
        throw new Error(`no handler for ${channel}`);
      }
      return await fn(undefined, ...args);
    },
  };
}

beforeEach(() => {
  registerSpy.mockClear();
  fakePreferences.read.mockReset();
});

describe("pier:agents:prepareLaunch", () => {
  it("已知 agent → 注册 launch，返回 non-null launchId", async () => {
    fakePreferences.read.mockResolvedValueOnce({
      agentCommandOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      agentPermissionMode: "manual",
    });

    const ipcMain = makeIpcMain();
    registerAgentsIpc(ipcMain as never);

    const result = (await ipcMain.invoke(
      "pier:agents:prepareLaunch",
      "claude" as AgentKind
    )) as { launchId: string | null };

    expect(result.launchId).toBe("launch-abc");
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith({
      agentId: "claude",
      command: expect.stringContaining("claude"),
    });
  });

  it("注册 launch 时带上 agent 默认 env", async () => {
    fakePreferences.read.mockResolvedValueOnce({
      agentCommandOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: { goose: { GOOSE_MODE: "auto" } },
      agentPermissionMode: "manual",
    });

    const ipcMain = makeIpcMain();
    registerAgentsIpc(ipcMain as never);

    const result = (await ipcMain.invoke(
      "pier:agents:prepareLaunch",
      "goose" as AgentKind
    )) as { launchId: string | null };

    expect(result.launchId).toBe("launch-abc");
    expect(registerSpy).toHaveBeenCalledWith({
      agentId: "goose",
      command: "goose",
      env: { GOOSE_MODE: "auto" },
    });
  });

  it("未知 agent (resolveAgentCommand → null) → launchId: null，不注册", async () => {
    fakePreferences.read.mockResolvedValueOnce({
      agentCommandOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      agentPermissionMode: "manual",
    });

    const ipcMain = makeIpcMain();
    registerAgentsIpc(ipcMain as never);

    const result = (await ipcMain.invoke(
      "pier:agents:prepareLaunch",
      "nope" as AgentKind
    )) as { launchId: string | null };

    expect(result.launchId).toBeNull();
    // No registration happened (assertion independent of any seeded id).
    expect(registerSpy).not.toHaveBeenCalled();
  });
});
