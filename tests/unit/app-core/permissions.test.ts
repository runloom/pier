import { authorizeCommand } from "@main/app-core/permissions.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
  pierCapabilitySchema,
  pierClientKindSchema,
} from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

const now = 1_772_000_000_000;

function client(
  kind: PierClient["kind"],
  capabilities = DEFAULT_CAPABILITIES_BY_CLIENT_KIND[kind]
): PierClient {
  return {
    capabilities,
    createdAt: now,
    id: `${kind}-1`,
    kind,
    lastSeenAt: now,
  };
}

describe("authorizeCommand", () => {
  it("允许 desktop renderer 执行窗口控制命令", () => {
    expect(
      authorizeCommand(
        { type: "window.close", windowId: "main" },
        client("desktop-renderer")
      )
    ).toEqual({ ok: true });
  });

  it("拒绝 MCP 默认客户端执行窗口关闭", () => {
    expect(
      authorizeCommand(
        { type: "window.close", windowId: "main" },
        client("mcp-local")
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: window:close",
    });
  });

  it("允许 cli-local 作为一等客户端类型", () => {
    expect(pierClientKindSchema.parse("cli-local")).toBe("cli-local");
  });

  it("允许 CLI 默认客户端聚焦窗口", () => {
    expect(
      authorizeCommand(
        { type: "window.focus", windowId: "main" },
        client("cli-local")
      )
    ).toEqual({ ok: true });
  });

  it("允许 CLI 默认客户端打开路径", () => {
    expect(
      authorizeCommand({ path: ".", type: "panel.open" }, client("cli-local"))
    ).toEqual({
      ok: true,
    });
  });

  it("拒绝 CLI 默认客户端关闭窗口", () => {
    expect(
      authorizeCommand(
        { type: "window.close", windowId: "main" },
        client("cli-local")
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: window:close",
    });
  });

  it("terminal.open 携带启动参数时要求 terminal:control", () => {
    expect(
      authorizeCommand(
        {
          launch: { command: "pnpm test", cwd: "/repo" },
          type: "terminal.open",
        },
        client("cli-local", ["workspace:open"])
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: terminal:control",
    });
    expect(
      authorizeCommand(
        { type: "terminal.open" },
        client("cli-local", ["workspace:open"])
      )
    ).toEqual({ ok: true });
  });

  it("允许 CLI 默认客户端读取和创建 worktree", () => {
    expect(
      authorizeCommand(
        { path: "/repo", type: "worktree.list" },
        client("cli-local")
      )
    ).toEqual({ ok: true });

    expect(
      authorizeCommand(
        {
          branch: "feature/a",
          name: "feature-a",
          path: "/repo",
          type: "worktree.create",
        },
        client("cli-local")
      )
    ).toEqual({ ok: true });
  });

  it("拒绝 MCP 默认客户端创建 worktree", () => {
    expect(
      authorizeCommand(
        {
          branch: "feature/a",
          name: "feature-a",
          path: "/repo",
          type: "worktree.create",
        },
        client("mcp-local")
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: worktree:write",
    });
  });

  it("预留插件能力但默认不授予 CLI/MCP 高危权限", () => {
    expect(pierCapabilitySchema.parse("plugin:read")).toBe("plugin:read");
    expect(pierCapabilitySchema.parse("plugin:write")).toBe("plugin:write");
    expect(pierCapabilitySchema.parse("command:register")).toBe(
      "command:register"
    );
    expect(pierCapabilitySchema.parse("panel:register")).toBe("panel:register");
    expect(pierCapabilitySchema.parse("secret:read")).toBe("secret:read");
    expect(pierCapabilitySchema.parse("network")).toBe("network");

    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]).toContain(
      "plugin:read"
    );
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]).not.toEqual(
      expect.arrayContaining([
        "plugin:write",
        "command:register",
        "panel:register",
        "secret:read",
        "network",
      ])
    );
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mcp-local"]).not.toEqual(
      expect.arrayContaining([
        "plugin:read",
        "plugin:write",
        "command:register",
        "panel:register",
        "secret:read",
        "network",
      ])
    );
  });

  it("允许 CLI 读取插件信息但拒绝 MCP 默认客户端读取插件信息", () => {
    expect(
      authorizeCommand({ type: "plugin.list" }, client("cli-local"))
    ).toEqual({ ok: true });
    expect(
      authorizeCommand({ type: "plugin.list" }, client("mcp-local"))
    ).toEqual({
      ok: false,
      reason: "missing capability: plugin:read",
    });
  });

  it("插件启停需要 plugin:write，CLI/MCP 默认客户端不能修改插件状态", () => {
    expect(
      authorizeCommand(
        { id: "pier.worktree", type: "plugin.disable" },
        client("desktop-renderer")
      )
    ).toEqual({ ok: true });
    expect(
      authorizeCommand(
        { id: "pier.worktree", type: "plugin.enable" },
        client("cli-local")
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: plugin:write",
    });
    expect(
      authorizeCommand(
        { id: "pier.worktree", type: "plugin.disable" },
        client("mcp-local")
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: plugin:write",
    });
  });

  it("允许 MCP 默认客户端读取工作区状态", () => {
    expect(
      authorizeCommand({ type: "panel.list" }, client("mcp-local"))
    ).toEqual({ ok: true });
  });

  it("拒绝缺少 preferences:write 的手机客户端更新偏好", () => {
    expect(
      authorizeCommand(
        {
          patch: { theme: "dark" },
          type: "preferences.update",
        },
        client("mobile-paired", ["app:read", "preferences:read"])
      )
    ).toEqual({
      ok: false,
      reason: "missing capability: preferences:write",
    });
  });

  it("requires file:read for file list and read commands", () => {
    const readClient = client("cli-local", ["file:read"]);
    const noFileReadClient = client("cli-local", []);

    const commands = [
      { path: "src", root: "/repo", type: "file.list" },
      { path: "src/index.ts", root: "/repo", type: "file.readText" },
    ] satisfies PierCommand[];

    for (const command of commands) {
      expect(authorizeCommand(command, readClient)).toEqual({ ok: true });
      expect(authorizeCommand(command, noFileReadClient)).toEqual({
        ok: false,
        reason: "missing capability: file:read",
      });
    }
  });

  it("requires file:write for file mutation commands", () => {
    expect(pierCapabilitySchema.parse("file:write")).toBe("file:write");

    const writeClient = client("desktop-renderer", ["file:write"]);
    const readOnlyClient = client("desktop-renderer", ["file:read"]);

    const commands = [
      {
        contents: "export const value = 1;\n",
        path: "src/index.ts",
        root: "/repo",
        type: "file.writeText",
      },
      {
        newPath: "packages/app/src/index.ts",
        path: "src/index.ts",
        root: "/repo",
        type: "file.move",
      },
      { path: "src/index.ts", root: "/repo", type: "file.trash" },
    ] satisfies PierCommand[];

    for (const command of commands) {
      expect(authorizeCommand(command, writeClient)).toEqual({ ok: true });
      expect(authorizeCommand(command, readOnlyClient)).toEqual({
        ok: false,
        reason: "missing capability: file:write",
      });
    }
  });

  it("account:read 命令允许 desktop-renderer 和 cli-local，拒绝 mcp-local", () => {
    const readCommands = [
      { type: "accounts.snapshot" },
      { type: "accounts.refreshUsage" },
    ] satisfies PierCommand[];
    for (const command of readCommands) {
      expect(authorizeCommand(command, client("desktop-renderer"))).toEqual({
        ok: true,
      });
      expect(authorizeCommand(command, client("cli-local"))).toEqual({
        ok: true,
      });
      expect(authorizeCommand(command, client("mcp-local"))).toEqual({
        ok: false,
        reason: "missing capability: account:read",
      });
    }
  });

  it("account:write 命令允许 desktop-renderer，拒绝 cli-local 和 mcp-local", () => {
    const writeCommands = [
      { type: "accounts.adoptCurrent" },
      { provider: "codex", type: "accounts.add" },
      { provider: "codex", type: "accounts.cancelLogin" },
      { accountId: "acc-001", type: "accounts.select" },
      { accountId: "acc-001", type: "accounts.remove" },
    ] satisfies PierCommand[];
    for (const command of writeCommands) {
      expect(authorizeCommand(command, client("desktop-renderer"))).toEqual({
        ok: true,
      });
      expect(authorizeCommand(command, client("cli-local"))).toEqual({
        ok: false,
        reason: "missing capability: account:write",
      });
      expect(authorizeCommand(command, client("mcp-local"))).toEqual({
        ok: false,
        reason: "missing capability: account:write",
      });
    }
  });
});
