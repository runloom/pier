import { readFileSync } from "node:fs";
import { performListCatalogSnapshot } from "@main/services/managed-plugins/catalog-operations.ts";
import type { OperationsContext } from "@main/services/managed-plugins/install-operations.ts";
import { createManagedPluginPaths } from "@main/services/managed-plugins/paths.ts";
import {
  isRetiredManagedPluginId,
  stripRetiredManagedPlugins,
} from "@main/services/managed-plugins/retired-plugins.ts";
import type {
  ManagedPluginInstallIndex,
  OfficialPluginIndex,
} from "@shared/contracts/plugin/managed.ts";
import { describe, expect, it } from "vitest";

function emptyInstallIndex(): ManagedPluginInstallIndex {
  return { version: 1, plugins: {} };
}

function officialCatalogIndex(
  plugins: OfficialPluginIndex["plugins"]
): OfficialPluginIndex {
  return {
    generatedAt: 1,
    plugins,
    sequence: 1,
    signature: { alg: "Ed25519", keyId: "test", value: "test" },
    version: 1,
  };
}

function officialEntry(id: string, displayName: string, version: string) {
  return {
    displayName,
    id,
    latest: version,
    versions: {
      [version]: {
        assetUrl: `https://github.com/runloom/pier/releases/download/${id}-${version}/${id}.tgz`,
        pier: ">=0.1.0 <0.2.0",
        sha256: "a".repeat(64),
        size: 1,
      },
    },
  };
}

function catalogContext(official: OfficialPluginIndex): OperationsContext {
  const state = emptyInstallIndex();
  return {
    appendOperationLog: async () => undefined,
    bundledPlugins: [],
    copyDirectory: async () => undefined,
    isDevRuntime: false,
    now: () => 1,
    officialIndexProvider: () => official,
    paths: createManagedPluginPaths("/tmp/pier-retired-plugins-test"),
    pierVersion: "0.1.5",
    refreshRuntimeSnapshot: async () => undefined,
    store: {
      flush: async () => undefined,
      get: () => state,
      init: async () => state,
      mutate: (fn) => fn(state),
    },
  };
}

describe("retired managed plugins", () => {
  it("recognizes former language pack ids", () => {
    expect(isRetiredManagedPluginId("pier.lsp-cpp")).toBe(true);
    expect(isRetiredManagedPluginId("pier.lsp-zig")).toBe(true);
    expect(isRetiredManagedPluginId("pier.codex")).toBe(false);
  });

  it("retires the renamed pier.tmux id so Agent splits is the only catalog row", () => {
    expect(isRetiredManagedPluginId("pier.tmux")).toBe(true);
    expect(isRetiredManagedPluginId("pier.agent-splits")).toBe(false);
  });

  it("keeps index generation from republishing retired ids", () => {
    const script = readFileSync("scripts/generate-plugin-index.mjs", "utf8");
    expect(script).toContain("RETIRED_MANAGED_PLUGIN_IDS");
    expect(script).toContain("retiredIds.has(");
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
            registeredAt: 0,
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
        "pier.tmux": {
          activeVersion: "1.0.0",
          devOverride: null,
          effectiveAtStartup: null,
          enabled: true,
          id: "pier.tmux",
          installedVersions: {},
          lastKnownGoodVersion: null,
          pendingRestart: null,
          pendingUpdate: null,
          source: { kind: "official" },
        },
      },
    });

    expect(removedIds).toEqual(["pier.lsp-cpp", "pier.tmux"]);
    expect(Object.keys(next.plugins)).toEqual(["pier.codex"]);
  });

  it("omits pier.tmux from the available-plugin catalog after the rename", async () => {
    const snapshot = await performListCatalogSnapshot(
      catalogContext(
        officialCatalogIndex({
          "pier.agent-splits": officialEntry(
            "pier.agent-splits",
            "Agent splits",
            "1.5.2"
          ),
          "pier.tmux": officialEntry("pier.tmux", "Native splits", "1.0.0"),
        })
      )
    );

    expect(snapshot.plugins.map((row) => row.id)).toEqual([
      "pier.agent-splits",
    ]);
  });
});
