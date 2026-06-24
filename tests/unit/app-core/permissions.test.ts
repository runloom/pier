import { authorizeCommand } from "@main/app-core/permissions.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
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

  it("允许 CLI 默认客户端打开终端", () => {
    expect(
      authorizeCommand({ type: "terminal.open" }, client("cli-local"))
    ).toEqual({
      ok: true,
    });
  });

  it("允许 CLI 默认客户端打开路径", () => {
    expect(
      authorizeCommand(
        { path: ".", type: "workspace.open" },
        client("cli-local")
      )
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
});
