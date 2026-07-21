import { createAgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import {
  type AgentRuntimeIndexEntry,
  makeAgentRef,
} from "@shared/contracts/agent-runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type {
  RendererCommand,
  RendererCommandResult,
} from "@shared/contracts/renderer-command.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const peekContext = vi.hoisted(() =>
  vi.fn(
    (_windowId: string, _panelId: string) =>
      null as null | {
        cwd?: string;
        projectRootPath: string;
        worktreeKey?: string;
      }
  )
);

vi.mock("@main/state/terminal-session-state.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@main/state/terminal-session-state.ts")
    >();
  return {
    ...actual,
    peekTerminalPanelContext: peekContext,
  };
});

function agent(
  overrides: Partial<Extract<ForegroundActivity, { kind: "agent" }>> & {
    panelId: string;
    windowId: string;
  }
): Extract<ForegroundActivity, { kind: "agent" }> {
  return {
    agentId: "claude",
    kind: "agent",
    source: "hook",
    spawnedAt: 1,
    subagentCount: 0,
    updatedAt: 10,
    ...overrides,
  };
}

function createService(args: {
  activities: ForegroundActivity[];
  ts?: number;
  resolveInternalWindowId?: (electronWindowId: string) => string | null;
  resolveSessionScope?: (electronWindowId: string) => string | null;
  execute?: (command: RendererCommand) => Promise<RendererCommandResult>;
}) {
  const execute =
    args.execute ??
    vi.fn(
      async (_command: RendererCommand): Promise<RendererCommandResult> => ({
        data: null,
        ok: true,
        requestId: "req-1",
      })
    );

  return {
    execute,
    service: createAgentRuntimeIndexService({
      snapshot: () => ({
        activities: args.activities,
        ts: args.ts ?? 7,
      }),
      rendererCommand: {
        execute,
        resolve: () => undefined,
      },
      resolveInternalWindowId:
        args.resolveInternalWindowId ??
        ((electronWindowId) => `internal-${electronWindowId}`),
      resolveSessionScope:
        args.resolveSessionScope ??
        ((electronWindowId) => `record-${electronWindowId}`),
    }),
  };
}

describe("agent runtime index service", () => {
  beforeEach(() => {
    peekContext.mockReset();
    peekContext.mockReturnValue(null);
  });

  it("listMachine projects all windows and keeps FA ts", () => {
    const { service } = createService({
      activities: [
        agent({
          panelId: "p-local",
          status: "ready",
          updatedAt: 1,
          windowId: "1",
        }),
        agent({
          agentId: "codex",
          panelId: "p-other",
          status: "waiting",
          updatedAt: 99,
          windowId: "2",
        }),
        {
          commandLine: "ls",
          kind: "shell",
          panelId: "p-shell",
          spawnedAt: 1,
          updatedAt: 2,
          windowId: "1",
        },
      ],
      ts: 42,
    });

    const snapshot = service.listMachine();
    expect(snapshot.ts).toBe(42);
    expect(
      snapshot.entries.map((e: AgentRuntimeIndexEntry) => e.panelId)
    ).toEqual(["p-other", "p-local"]);
  });

  it("listMachine joins panel context via session scope (record id)", () => {
    peekContext.mockImplementation((scope: string, panelId: string) => {
      expect(scope).toBe("record-11");
      expect(panelId).toBe("panel-a");
      return { projectRootPath: "/tmp/pier", cwd: "/tmp/pier/src" };
    });
    const { service } = createService({
      activities: [
        agent({
          panelId: "panel-a",
          status: "waiting",
          windowId: "11",
        }),
      ],
      resolveSessionScope: () => "record-11",
    });
    const [entry] = service.listMachine().entries;
    expect(entry).toMatchObject({
      cwd: "/tmp/pier/src",
      projectRootPath: "/tmp/pier",
    });
    expect(peekContext).toHaveBeenCalledWith("record-11", "panel-a");
  });

  it("focus sends panel.focus with internal windowId", async () => {
    const agentRef = makeAgentRef("11", "panel-a");
    const { execute, service } = createService({
      activities: [
        agent({
          panelId: "panel-a",
          status: "processing",
          windowId: "11",
        }),
      ],
      resolveInternalWindowId: (id) => {
        expect(id).toBe("11");
        return "main";
      },
    });

    await expect(service.focus(agentRef)).resolves.toEqual({ status: "ok" });
    expect(execute).toHaveBeenCalledWith({
      focus: true,
      panelId: "panel-a",
      type: "panel.focus",
      windowId: "main",
    });
  });

  it("focus returns panel_gone for unknown or malformed refs", async () => {
    const { execute, service } = createService({
      activities: [
        agent({ panelId: "panel-a", status: "ready", windowId: "1" }),
      ],
    });

    await expect(service.focus("not-a-ref")).resolves.toEqual({
      status: "panel_gone",
    });
    await expect(service.focus(makeAgentRef("1", "missing"))).resolves.toEqual({
      status: "panel_gone",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("focus returns window_gone when electron window cannot be mapped", async () => {
    const { execute, service } = createService({
      activities: [
        agent({ panelId: "panel-a", status: "ready", windowId: "9" }),
      ],
      resolveInternalWindowId: () => null,
    });

    await expect(service.focus(makeAgentRef("9", "panel-a"))).resolves.toEqual({
      status: "window_gone",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("focusWaiting picks first Needs you entry then focuses", async () => {
    const { execute, service } = createService({
      activities: [
        agent({
          panelId: "ready",
          status: "ready",
          updatedAt: 100,
          windowId: "1",
        }),
        agent({
          panelId: "wait",
          status: "waiting",
          updatedAt: 50,
          windowId: "2",
        }),
        agent({
          panelId: "err",
          status: "error",
          updatedAt: 40,
          windowId: "3",
        }),
      ],
    });

    await expect(service.focusWaiting()).resolves.toEqual({ status: "ok" });
    expect(execute).toHaveBeenCalledWith({
      focus: true,
      panelId: "wait",
      type: "panel.focus",
      windowId: "internal-2",
    });
  });

  it("focusWaiting returns empty when nothing needs you", async () => {
    const { execute, service } = createService({
      activities: [
        agent({
          panelId: "ready",
          status: "ready",
          windowId: "1",
        }),
      ],
    });

    await expect(service.focusWaiting()).resolves.toEqual({ status: "empty" });
    expect(execute).not.toHaveBeenCalled();
  });
});
