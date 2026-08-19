import type * as TerminationModule from "@main/services/lsp/process-termination.ts";
import { LspSessionHost } from "@main/services/lsp/session-host.ts";
import type * as SupervisorModule from "@main/services/lsp/windows-supervisor.ts";
import { WorkspaceLspPolicy } from "@main/services/lsp/workspace-policy.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeLspChild } from "./test-fixtures.ts";

const terminationMocks = vi.hoisted(() => ({
  launchWindowsProcessTree: vi.fn(),
  loadWindowsJobAddon: vi.fn(() => ({})),
  spawnWindowsSupervisor: vi.fn(),
}));

vi.mock("@main/services/lsp/process-termination.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof TerminationModule>();
  return {
    ...actual,
    launchWindowsProcessTree: terminationMocks.launchWindowsProcessTree,
    loadWindowsJobAddon: terminationMocks.loadWindowsJobAddon,
  };
});
vi.mock("@main/services/lsp/windows-supervisor.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisorModule>();
  return {
    ...actual,
    spawnWindowsSupervisor: terminationMocks.spawnWindowsSupervisor,
  };
});

describe("Windows LSP setup failure lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    terminationMocks.launchWindowsProcessTree.mockReset();
    terminationMocks.loadWindowsJobAddon.mockClear();
    terminationMocks.spawnWindowsSupervisor.mockReset();
  });

  it("settles the host tree latch and removes the policy blocker after bounded setup cleanup", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = new FakeLspChild(8123);
    const supervisorTerminal = Promise.withResolvers<void>();
    child.once("close", () => supervisorTerminal.resolve());
    terminationMocks.spawnWindowsSupervisor.mockReturnValue({
      child,
      closeControl: vi.fn(),
      ready: Promise.resolve(),
      sendStart: vi.fn(),
      terminal: supervisorTerminal.promise,
    });
    const setupFailure = new Error("assignment failed after bounded cleanup");
    terminationMocks.launchWindowsProcessTree.mockImplementation(
      ({ spawnSupervisor }) => {
        spawnSupervisor();
        return Promise.resolve().then(() => {
          child.exit(1);
          throw setupFailure;
        });
      }
    );

    const host = new LspSessionHost();
    const policy = new WorkspaceLspPolicy();
    const workspaceKey = "main:C:\\repo";
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "C:\\repo",
      workspaceKey,
    });
    const outcomes: Record<string, unknown>[] = [];
    const treeTerminalReceived = Promise.withResolvers<{
      barrier: Promise<void>;
    }>();
    const policyReleased = Promise.withResolvers<void>();
    let treeTerminalState: "pending" | "resolved" | "rejected" = "pending";
    const session = host.ensure({
      launch: { args: [], command: "fake-ls", cwd: "C:\\repo" },
      onClose: (event, treeTerminal) => {
        treeTerminalReceived.resolve({ barrier: treeTerminal });
        outcomes.push(event);
        policy.markTreeDraining(workspaceKey, event.sessionId);
        treeTerminal.then(
          () => {
            treeTerminalState = "resolved";
            policy.release(workspaceKey, event.sessionId);
            policy.markTreeTerminal(event.sessionId);
            policyReleased.resolve();
          },
          () => {
            treeTerminalState = "rejected";
          }
        );
      },
      onMessage: vi.fn(),
      rootPath: "C:\\repo",
      serverId: "typescript",
      workspaceKey,
    });
    policy.bindSession(workspaceKey, session.sessionId);

    const { barrier: treeTerminal } = await treeTerminalReceived.promise;
    await treeTerminal;
    await policyReleased.promise;

    expect(outcomes).toEqual([
      { reason: "failed", sessionId: session.sessionId },
    ]);
    expect(treeTerminalState).toBe("resolved");
    expect(policy.hasTreeBlocker(workspaceKey)).toBe(false);
    expect(policy.sessionsOf(workspaceKey)).not.toContain(session.sessionId);
    await expect(host.dispose()).resolves.toBeUndefined();
    expect(outcomes).toHaveLength(1);
  });
});
