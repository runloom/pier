// @vitest-environment node

import {
  authorizeForPluginPrincipal,
  createPluginPrincipalClient,
  pluginPrincipalClientId,
} from "@main/app-core/permissions.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

function command(type: string): PierCommand {
  return { type } as unknown as PierCommand;
}

describe("plugin principal authorization (Phase 2 M1)", () => {
  it("has a static-empty default capability set — deny by default", () => {
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["plugin-principal"]).toEqual([]);
  });

  it("denies every command for principals while no command opts in", () => {
    // 未开闸的命令：即使 manifest 声明了对应能力也拒绝。
    const result = authorizeForPluginPrincipal({
      command: command("file.readDocument"),
      pluginId: "third.party",
      manifestPermissions: ["file:read"],
    });
    expect(result.ok).toBe(false);
  });

  it("builds a principal client with id prefix and manifest-derived capabilities", () => {
    const client = createPluginPrincipalClient("third.party", [
      "file:read",
      "not-a-real-capability",
    ]);
    expect(client.id).toBe("plugin:third.party");
    expect(client.kind).toBe("plugin-principal");
    // 未知能力字符串被过滤，不进能力集。
    expect(client.capabilities).toEqual(["file:read"]);
  });

  it("round-trips the client id convention", () => {
    expect(pluginPrincipalClientId("pier.codex")).toBe("plugin:pier.codex");
  });
});
