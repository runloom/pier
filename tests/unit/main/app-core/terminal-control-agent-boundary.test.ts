/**
 * W4-S2：agent 终端禁止 terminal.send/key 旁路 RuntimeRef。
 */

import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import {
  executeTerminalKeyCommand,
  executeTerminalListCommand,
  executeTerminalSendCommand,
} from "@main/app-core/commands/terminal-control.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("@main/app-core/commands/panel.ts", () => ({
  listPanels: async () => ({
    errors: [],
    panels: [
      {
        id: "agent-panel",
        windowId: "w1",
        component: "terminal",
        active: true,
        params: { agentId: "codex" },
        context: { projectRootPath: "/repo", worktreeKey: "/repo" },
      },
      {
        // 无 params.agentId；仅靠 Runtime Index panelId 识别（window 词表可不同）
        id: "index-only-agent",
        windowId: "internal-w1",
        component: "terminal",
        active: true,
        context: { projectRootPath: "/repo", worktreeKey: "/repo" },
      },
      {
        id: "shell-panel",
        windowId: "w1",
        component: "terminal",
        active: false,
        context: { projectRootPath: "/repo", worktreeKey: "/repo" },
      },
    ],
  }),
}));

vi.mock("@main/ipc/terminal/index.ts", () => ({
  getTerminalAddon: () => null,
}));

function services(entries: Record<string, unknown>[]): PierCoreServices {
  return {
    agentRuntimeIndex: {
      listMachine: () => ({ entries }),
    },
  } as never;
}

describe("terminal send/key agent boundary (W4-S2)", () => {
  it("rejects send when params.agentId set", async () => {
    const result = await executeTerminalSendCommand(
      "r1",
      {
        type: "terminal.send",
        panelId: "agent-panel",
        text: "hello",
      },
      services([])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/agents\.turn/u);
    }
  });

  it("rejects by panelId even when FA windowId vocabulary differs", async () => {
    // list 用 internal-w1；FA 用 electron window "9"；无 params.agentId
    const result = await executeTerminalSendCommand(
      "r2",
      {
        type: "terminal.send",
        panelId: "index-only-agent",
        text: "x",
      },
      services([
        {
          agentId: "codex",
          panelId: "index-only-agent",
          windowId: "9",
          status: "ready",
        },
      ])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/agents\.turn/u);
    }
  });

  it("rejects key to agent panel", async () => {
    const result = await executeTerminalKeyCommand(
      "r3",
      {
        type: "terminal.key",
        panelId: "agent-panel",
        key: "enter",
      },
      services([])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/agents\./u);
    }
  });

  it("list labels index-only agent as role=agent", async () => {
    const result = await executeTerminalListCommand(
      "r4",
      { type: "terminal.list" },
      services([
        {
          agentId: "codex",
          panelId: "index-only-agent",
          windowId: "9",
          status: "ready",
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        terminals: Array<{ panelId: string; role: string; agentId?: string }>;
      };
      const hit = data.terminals.find((t) => t.panelId === "index-only-agent");
      expect(hit?.role).toBe("agent");
      expect(hit?.agentId).toBe("codex");
    }
  });
});
