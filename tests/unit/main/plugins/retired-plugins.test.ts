import {
  isRetiredManagedPluginId,
  stripRetiredManagedPlugins,
} from "@main/services/managed-plugins/retired-plugins.ts";
import { describe, expect, it } from "vitest";

describe("retired managed plugins", () => {
  it("recognizes former language pack ids", () => {
    expect(isRetiredManagedPluginId("pier.lsp-cpp")).toBe(true);
    expect(isRetiredManagedPluginId("pier.lsp-zig")).toBe(true);
    expect(isRetiredManagedPluginId("pier.codex")).toBe(false);
  });

  it("strips retired entries from the install index", () => {
    const { next, removedIds } = stripRetiredManagedPlugins({
      version: 1,
      plugins: {
        "pier.codex": {
          activeVersion: "1.0.0",
          devOverride: null,
          effectiveAtStartup: null,
          enabled: true,
          id: "pier.codex",
          installedVersions: {},
          lastKnownGoodVersion: null,
          pendingRestart: null,
          pendingUpdate: null,
          source: { kind: "official" },
        },
        "pier.lsp-cpp": {
          activeVersion: "1.0.0",
          devOverride: {
            path: "/tmp/plugin-lsp-cpp",
            version: "1.0.0",
          },
          effectiveAtStartup: {
            enabled: true,
            sourceKind: "devOverride",
            version: "1.0.0",
          },
          enabled: true,
          id: "pier.lsp-cpp",
          installedVersions: {
            "1.0.0": {
              contentHash: "x",
              installedAt: 1,
              packageUrl: "workspace://pier.lsp-cpp/1.0.0",
              sha256: "x",
            },
          },
          lastKnownGoodVersion: "1.0.0",
          pendingRestart: null,
          pendingUpdate: null,
          source: { kind: "devOverride" },
        },
      },
    });

    expect(removedIds).toEqual(["pier.lsp-cpp"]);
    expect(Object.keys(next.plugins)).toEqual(["pier.codex"]);
  });
});
