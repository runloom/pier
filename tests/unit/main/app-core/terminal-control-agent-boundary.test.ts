/**
 * W3：agent 终端允许 terminal.send/key（与 screen 同构），供假 tmux send-keys。
 * screen/close 对 agent 必须成功；缺失/非 terminal/无 native 符号有对应错误码。
 */

import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeTerminalCloseCommand } from "@main/app-core/commands/terminal-close.ts";
import {
  executeTerminalKeyCommand,
  executeTerminalListCommand,
  executeTerminalSendCommand,
} from "@main/app-core/commands/terminal-control.ts";
import {
  executeTerminalReadCommand,
  executeTerminalScreenCommand,
} from "@main/app-core/commands/terminal-screen.ts";
import { clampScreenText } from "@main/services/runtime-control/screen-text.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    data: null,
    ok: true as const,
    requestId: "renderer-req",
  }))
);

const addonState = vi.hoisted(() => ({
  readViewportText: (() => "agent viewport") as
    | (() => string | null)
    | undefined,
}));

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
      {
        id: "files-panel",
        windowId: "w1",
        component: "files",
        active: false,
      },
    ],
  }),
}));

vi.mock("@main/ipc/terminal/index.ts", () => ({
  getTerminalAddon: () => {
    if (addonState.readViewportText === undefined) {
      return { sendText: () => true };
    }
    return {
      readViewportText: addonState.readViewportText,
      sendText: () => true,
    };
  },
}));

vi.mock("@main/windows/identity.ts", () => ({
  findAppWindowByInternalId: () => ({
    id: 7,
    isDestroyed: () => false,
  }),
  findAppWindowForActivityWindowId: () => ({
    id: 7,
    isDestroyed: () => false,
  }),
}));

function services(entries: Record<string, unknown>[]): PierCoreServices {
  return {
    agentRuntimeIndex: {
      listMachine: () => ({ entries }),
    },
    rendererCommand: {
      execute: rendererExecute,
    },
  } as never;
}

describe("terminal send/key agent boundary (W3)", () => {
  beforeEach(() => {
    rendererExecute.mockClear();
    addonState.readViewportText = () => "agent viewport";
  });

  it("sends text when params.agentId set", async () => {
    const result = await executeTerminalSendCommand(
      "r1",
      {
        type: "terminal.send",
        panelId: "agent-panel",
        text: "hello",
      },
      services([])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        accepted: true,
        panelId: "agent-panel",
      });
    }
  });

  it("sends by panelId even when FA windowId vocabulary differs", async () => {
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
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        accepted: true,
        panelId: "index-only-agent",
      });
    }
  });

  it("sends key to agent panel", async () => {
    const result = await executeTerminalKeyCommand(
      "r3",
      {
        type: "terminal.key",
        panelId: "agent-panel",
        key: "enter",
      },
      services([])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        accepted: true,
        key: "enter",
        panelId: "agent-panel",
      });
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

  it("reads viewport on agent panels (screen, not send)", async () => {
    const result = await executeTerminalScreenCommand(
      "r5",
      { type: "terminal.screen", panelId: "agent-panel" },
      services([])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        panelId: "agent-panel",
        scope: "viewport",
        text: "agent viewport",
        windowId: "w1",
      });
    }
  });

  it("closes agent terminal panels", async () => {
    const result = await executeTerminalCloseCommand(
      "r6",
      { type: "terminal.close", panelId: "agent-panel" },
      services([])
    );
    expect(result.ok).toBe(true);
    expect(rendererExecute).toHaveBeenCalledWith({
      panelId: "agent-panel",
      type: "panel.close",
      windowId: "w1",
    });
  });

  it("returns not_found when the panel is missing", async () => {
    const result = await executeTerminalScreenCommand(
      "missing",
      { type: "terminal.screen", panelId: "ghost" },
      services([])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("returns not_found when closing a missing panel", async () => {
    const result = await executeTerminalCloseCommand(
      "missing-close",
      { type: "terminal.close", panelId: "ghost" },
      services([])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("returns invalid_command when closing a non-terminal panel", async () => {
    const result = await executeTerminalCloseCommand(
      "files",
      { type: "terminal.close", panelId: "files-panel" },
      services([])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_command");
      expect(result.error.message).toMatch(/not a terminal/u);
    }
  });

  it("returns platform_unavailable when native viewport symbol is missing", async () => {
    addonState.readViewportText = undefined;
    const result = await executeTerminalScreenCommand(
      "nosym",
      { type: "terminal.screen", panelId: "shell-panel" },
      services([])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("platform_unavailable");
    }
  });

  it("read matches screen (viewport only) and applies clampScreenText bounds", async () => {
    addonState.readViewportText = () => "a\nb\nc\nd";
    const result = await executeTerminalReadCommand(
      "read-1",
      {
        type: "terminal.read",
        panelId: "shell-panel",
        maxLines: 2,
      },
      services([])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const clamped = clampScreenText("a\nb\nc\nd", 2, 65_536);
    expect(result.data).toMatchObject({
      panelId: "shell-panel",
      scope: "viewport",
      text: clamped.text,
      truncated: true,
      maxLines: 2,
      windowId: "w1",
    });
  });
});
