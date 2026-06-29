import { registerAgentsIpc } from "@main/ipc/agents.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { describe, expect, it, vi } from "vitest";

// A minimal launch registry that captures registered launches for assertions.
function makeFakeRegistry() {
  const store = new Map<string, { command: string }>();
  let nextId = "launch-abc";
  return {
    setNextId(id: string) {
      nextId = id;
    },
    register(launch: { command: string }) {
      const id = nextId;
      store.set(id, launch);
      return id;
    },
    consume(id: string) {
      const entry = store.get(id) ?? null;
      store.delete(id);
      return entry;
    },
    read(id: string) {
      return store.get(id) ?? null;
    },
    discard(id: string) {
      store.delete(id);
    },
  };
}

const fakePreferences = { read: vi.fn() };
const fakeRegistry = makeFakeRegistry();

vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    services: {
      preferences: { read: () => fakePreferences.read() },
      terminalLaunches: {
        register: (launch: { command: string }) =>
          fakeRegistry.register(launch),
        consume: (id: string) => fakeRegistry.consume(id),
        read: (id: string) => fakeRegistry.read(id),
        discard: (id: string) => fakeRegistry.discard(id),
      },
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

describe("pier:agents:prepareLaunch", () => {
  it("已知 agent → 注册 launch，返回 non-null launchId", async () => {
    fakePreferences.read.mockResolvedValueOnce({
      agentCommandOverrides: {},
      agentDefaultArgs: {},
    });

    const ipcMain = makeIpcMain();
    registerAgentsIpc(ipcMain as never);

    const result = (await ipcMain.invoke(
      "pier:agents:prepareLaunch",
      "claude" as AgentKind
    )) as { launchId: string | null };

    expect(result.launchId).toBe("launch-abc");
    expect(fakeRegistry.consume("launch-abc")).toMatchObject({
      command: expect.stringContaining("claude"),
    });
  });

  it("未知 agent (resolveAgentCommand → null) → launchId: null，不注册", async () => {
    fakePreferences.read.mockResolvedValueOnce({
      agentCommandOverrides: {},
      agentDefaultArgs: {},
    });

    const ipcMain = makeIpcMain();
    registerAgentsIpc(ipcMain as never);

    const result = (await ipcMain.invoke(
      "pier:agents:prepareLaunch",
      "nope" as AgentKind
    )) as { launchId: string | null };

    expect(result.launchId).toBeNull();
    // Nothing registered
    expect(fakeRegistry.read("launch-abc")).toBeNull();
  });
});
