// @vitest-environment node

import { buildPluginWorkspacePlan } from "@main/app-core/plugin-workspace-plan.ts";
import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

function listResult(): PluginRegistryListResult {
  return {
    diagnostics: [
      {
        code: "invalid_manifest",
        message: "broken manifest",
        source: { kind: "local", path: "/tmp/broken/plugin.json" },
      },
    ],
    entries: [
      {
        effectivePermissions: ["file:read", "file:write"],
        enabled: true,
        manifest: {
          id: "files",
          permissions: ["file:read"],
          publisher: "Pier",
          source: { kind: "builtin" },
          version: "1.0.0",
        },
        runtime: {
          canToggle: false,
          enabled: true,
          kind: "builtin",
        },
      },
    ] as PluginRegistryListResult["entries"],
  };
}

describe("plugin workspace plan (打印即所装)", () => {
  it("projects the registry list that feeds runtime.refresh — same data, no re-resolution", () => {
    const plan = buildPluginWorkspacePlan(listResult(), "workspace");

    expect(plan.mode).toBe("workspace");
    expect(plan.diagnostics).toHaveLength(1);
    expect(plan.entries).toHaveLength(1);
    const entry = plan.entries[0];
    expect(entry?.id).toBe("files");
    expect(entry?.source).toEqual({ kind: "builtin" });
    expect(entry?.permissions).toEqual(["file:read", "file:write"]);
    expect(entry?.runtime).toEqual({
      canToggle: false,
      enabled: true,
      kind: "builtin",
    });
  });

  it("keeps rejected manifests visible in diagnostics — part of what will happen", () => {
    const plan = buildPluginWorkspacePlan(listResult(), "release");
    expect(plan.diagnostics[0]?.message).toBe("broken manifest");
    expect(plan.entries.some((entry) => entry.id === "broken")).toBe(false);
  });
});
