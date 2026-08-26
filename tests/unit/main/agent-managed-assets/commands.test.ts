import {
  authorizeCommand,
  createPluginPrincipalClient,
} from "@main/app-core/permissions.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { describe, expect, it } from "vitest";

const enableCmd = {
  root: { projectRootPath: "/p", scope: "project" },
  type: "memory.enable",
} as PierCommand;

const desktop = {
  capabilities: ["workspace:read", "panel:open", "managedAssets:write"],
  createdAt: 0,
  id: "w1",
  kind: "desktop-renderer" as const,
  lastSeenAt: 0,
};

describe("memory command authorization", () => {
  it("desktop-renderer with managedAssets:write passes", () => {
    expect(authorizeCommand(enableCmd, desktop)).toEqual({ ok: true });
  });

  it("plugin principal denied (allowPluginPrincipals absent)", () => {
    const client = createPluginPrincipalClient("pier.memory", [
      "managedAssets:write",
    ]);
    expect(authorizeCommand(enableCmd, client).ok).toBe(false);
  });

  it("cli-local denied by client-kind allowlist", () => {
    const cli = {
      capabilities: ["managedAssets:write"],
      createdAt: 0,
      id: "c",
      kind: "cli-local" as const,
      lastSeenAt: 0,
    };
    expect(authorizeCommand(enableCmd, cli).ok).toBe(false);
  });
});
