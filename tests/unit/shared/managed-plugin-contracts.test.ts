import {
  managedPluginCatalogSnapshotSchema,
  managedPluginInstallIndexSchema,
  managedPluginPackageManifestSchema,
  officialPluginIndexSchema,
} from "@shared/contracts/managed-plugin.ts";
import {
  pluginRpcEventPayloadSchema,
  pluginRpcInvokeRequestSchema,
} from "@shared/contracts/plugin-rpc.ts";
import { describe, expect, it } from "vitest";

const manifest = {
  apiVersion: 1,
  commands: [{ id: "pier.codex.addAccount", title: "Codex: Add Account" }],
  missionControlWidgets: [],
  engines: { pier: ">=0.1.0 <0.2.0" },
  id: "pier.codex",
  main: "dist/main.js",
  name: "Codex",
  panels: [],
  permissions: ["plugin:read"],
  renderer: "dist/renderer.js",
  terminalStatusItems: [],
  version: "1.0.0",
};

describe("managed plugin contracts", () => {
  it("accepts a package manifest without source metadata", () => {
    expect(managedPluginPackageManifestSchema.parse(manifest)).toMatchObject({
      id: "pier.codex",
    });
  });

  it("rejects absolute package entry paths", () => {
    expect(() =>
      managedPluginPackageManifestSchema.parse({
        ...manifest,
        main: "/tmp/main.js",
      })
    ).toThrow();
  });

  it("rejects package entry paths with `..` segments", () => {
    expect(() =>
      managedPluginPackageManifestSchema.parse({
        ...manifest,
        main: "../escape/main.js",
      })
    ).toThrow();
  });

  it("accepts install index records", () => {
    expect(
      managedPluginInstallIndexSchema.parse({
        version: 1,
        plugins: {
          "pier.codex": {
            activeVersion: "1.0.0",
            devOverride: null,
            enabled: true,
            id: "pier.codex",
            installedVersions: {
              "1.0.0": {
                installedAt: 1,
                packageUrl: "bundled://pier.codex/1.0.0",
                sha256: "abc",
              },
            },
            pendingUpdate: null,
            pendingRestart: null,
            effectiveAtStartup: {
              version: "1.0.0",
              enabled: true,
              sourceKind: "official",
            },
            source: { kind: "official", seededFromBundle: true },
          },
        },
      })
    ).toMatchObject({ plugins: { "pier.codex": { enabled: true } } });
  });

  it("accepts uninstall tombstone records", () => {
    const parsed = managedPluginInstallIndexSchema.parse({
      version: 1,
      plugins: {
        "pier.codex": {
          activeVersion: null,
          devOverride: null,
          enabled: false,
          id: "pier.codex",
          installedVersions: {},
          pendingUpdate: null,
          pendingRestart: { kind: "uninstall" },
          effectiveAtStartup: {
            version: "1.0.0",
            enabled: true,
            sourceKind: "official",
          },
          source: { kind: "official", seededFromBundle: true },
          uninstalledAt: 123,
        },
      },
    });
    expect(parsed).toMatchObject({
      plugins: {
        "pier.codex": {
          activeVersion: null,
          uninstalledAt: 123,
          pendingRestart: { kind: "uninstall" },
        },
      },
    });
  });

  it("accepts managed catalog snapshots for settings UI", () => {
    expect(
      managedPluginCatalogSnapshotSchema.parse({
        checkedAt: 123,
        plugins: [
          {
            id: "pier.codex",
            displayName: "Codex",
            installed: true,
            desired: {
              enabled: false,
              version: "1.1.0",
              source: "official",
            },
            effective: {
              enabled: true,
              version: "1.0.0",
              source: "official",
            },
            lastKnownGoodVersion: "1.0.0",
            pendingRestart: { kind: "update", version: "1.1.0" },
            update: null,
            offlineRestoreAvailable: false,
            diagnostics: [],
          },
          {
            id: "pier.other",
            displayName: "Other",
            installed: false,
            desired: { enabled: false, version: null, source: "official" },
            effective: null,
            lastKnownGoodVersion: null,
            pendingRestart: null,
            update: { version: "1.0.0" },
            offlineRestoreAvailable: false,
            diagnostics: [],
          },
        ],
      }).plugins
    ).toHaveLength(2);
  });

  it("accepts signed official index entries", () => {
    expect(
      officialPluginIndexSchema.parse({
        generatedAt: 1_783_449_600_000,
        version: 1,
        sequence: 42,
        plugins: {
          "pier.codex": {
            description: "Codex account management",
            displayName: "Codex",
            id: "pier.codex",
            latest: "1.1.0",
            versions: {
              "1.1.0": {
                assetUrl:
                  "https://github.com/pier-plugins/codex/releases/download/v1.1.0/pier-codex-1.1.0.tgz",
                pier: ">=0.1.0 <0.2.0",
                sha256: "def",
                size: 100,
              },
            },
          },
        },
        signature: {
          keyId: "pier-official-2026-01",
          alg: "Ed25519",
          value: "base64-signature",
        },
      })
    ).toMatchObject({ plugins: { "pier.codex": { latest: "1.1.0" } } });
  });

  it("accepts plugin RPC messages", () => {
    expect(
      pluginRpcInvokeRequestSchema.parse({
        pluginId: "pier.codex",
        method: "accounts.snapshot",
        payload: null,
      })
    ).toMatchObject({ method: "accounts.snapshot" });
    expect(
      pluginRpcEventPayloadSchema.parse({
        pluginId: "pier.codex",
        event: "accounts.changed",
        payload: { accounts: [] },
      })
    ).toMatchObject({ event: "accounts.changed" });
  });
});
