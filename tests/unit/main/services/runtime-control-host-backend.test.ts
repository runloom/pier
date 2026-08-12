import { createHostTerminalBackend } from "@main/services/runtime-control/host-backend.ts";
import { describe, expect, it, vi } from "vitest";

describe("createHostTerminalBackend", () => {
  it("start maps terminal.open result to runtime ids", async () => {
    const executeCommand = vi.fn(async () => ({
      ok: true as const,
      requestId: "r1",
      data: { panelId: "panel_1", windowId: "win_1" },
    }));
    const backend = createHostTerminalBackend({ executeCommand });
    const created = await backend.create({
      agentId: "codex",
      cwd: "/tmp/repo",
    });
    expect(created).toEqual({
      panelId: "panel_1",
      windowId: "win_1",
      runtimeId: "panel_1",
      cwd: "/tmp/repo",
    });
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          type: "terminal.open",
          launch: expect.objectContaining({
            agentId: "codex",
            cwd: "/tmp/repo",
          }),
        }),
      })
    );
  });

  it("rejects unknown agent ids", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: {},
      }),
    });
    await expect(backend.create({ agentId: "not-an-agent" })).rejects.toThrow(
      /unknown agent/u
    );
  });

  it("propagates terminal.open failure", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: false as const,
        requestId: "r",
        error: { code: "platform_unavailable", message: "no window" },
      }),
    });
    await expect(backend.create({ agentId: "codex" })).rejects.toThrow(
      /no window/u
    );
  });
});
