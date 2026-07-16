import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isWorkspacePluginPackageReady,
  syncWorkspaceDevPluginOverrides,
  workspacePackageDir,
} from "../../../src/main/services/managed-plugins/workspace-dev-plugins.ts";
import type { ManagedPluginInstallIndex } from "../../../src/shared/contracts/managed-plugin.ts";

describe("workspace dev plugin isolation", () => {
  it("detects a ready workspace package root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-ws-plugin-"));
    expect(isWorkspacePluginPackageReady(root)).toBe(false);
    await writeFile(join(root, "plugin.json"), "{}");
    expect(isWorkspacePluginPackageReady(root)).toBe(false);
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist/main.js"), "export {}");
    expect(isWorkspacePluginPackageReady(root)).toBe(true);
  });

  it("syncs installed plugins to workspace package dirs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-ws-cwd-"));
    const packageDir = join(cwd, "packages/plugin-grok");
    await mkdir(join(packageDir, "dist"), { recursive: true });
    await writeFile(
      join(packageDir, "plugin.json"),
      JSON.stringify({ id: "pier.grok", version: "1.0.1" })
    );
    await writeFile(join(packageDir, "dist/main.js"), "export {}");

    const index: ManagedPluginInstallIndex = {
      plugins: {
        "pier.grok": {
          activeVersion: "1.0.0",
          devOverride: null,
          effectiveAtStartup: {
            enabled: true,
            sourceKind: "official",
            version: "1.0.0",
          },
          enabled: true,
          id: "pier.grok",
          installedVersions: {
            "1.0.0": {
              contentHash: "abc",
              installedAt: 1,
              packageUrl: "bundled://pier.grok/1.0.0",
              sha256: "abc",
            },
          },
          lastKnownGoodVersion: null,
          pendingRestart: null,
          pendingUpdate: null,
          source: { kind: "official" },
        },
      },
      version: 1,
    };

    const setDevOverride = vi.fn(async (id: string, path: string) => {
      index.plugins[id] = {
        ...index.plugins[id]!,
        devOverride: {
          path,
          registeredAt: 1,
          version: "1.0.1",
        },
      };
      return { ok: true as const, pluginId: id, requiresRestart: true };
    });
    const applyEffective = vi.fn(async () => {
      index.plugins["pier.grok"] = {
        ...index.plugins["pier.grok"]!,
        effectiveAtStartup: {
          enabled: true,
          sourceKind: "devOverride",
          version: "1.0.1",
        },
      };
    });

    const result = await syncWorkspaceDevPluginOverrides({
      applyEffective,
      cwd,
      getIndex: () => index,
      setDevOverride,
      specs: [{ devPackageDir: "packages/plugin-grok", id: "pier.grok" }],
    });

    expect(result.applied).toEqual(["pier.grok"]);
    expect(setDevOverride).toHaveBeenCalledWith("pier.grok", packageDir);
    expect(applyEffective).toHaveBeenCalledTimes(1);
    expect(
      workspacePackageDir(cwd, {
        devPackageDir: "packages/plugin-grok",
        id: "pier.grok",
      })
    ).toBe(packageDir);
  });

  it("path-seeds custom plugins via setDevOverride when not installed", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-ws-cwd-"));
    const packageDir = join(cwd, "my-custom-plugin");
    await mkdir(join(packageDir, "dist"), { recursive: true });
    await writeFile(
      join(packageDir, "plugin.json"),
      JSON.stringify({ id: "my.custom", version: "0.1.0" })
    );
    await writeFile(join(packageDir, "dist/main.js"), "export {}");

    const index: ManagedPluginInstallIndex = {
      plugins: {},
      version: 1,
    };
    const setDevOverride = vi.fn(async (id: string, path: string) => {
      index.plugins[id] = {
        activeVersion: "0.1.0",
        devOverride: { path, registeredAt: 1, version: "0.1.0" },
        effectiveAtStartup: null,
        enabled: true,
        id,
        installedVersions: {
          "0.1.0": {
            contentHash: "workspace-seed:my.custom@0.1.0",
            installedAt: 1,
            packageUrl: "workspace://my.custom/0.1.0",
            sha256: "workspace-seed:my.custom@0.1.0",
          },
        },
        lastKnownGoodVersion: null,
        pendingRestart: { kind: "devOverride" },
        pendingUpdate: null,
        source: { kind: "devOverride" },
      };
      return { ok: true as const, pluginId: id, requiresRestart: true };
    });
    const applyEffective = vi.fn(async () => {
      index.plugins["my.custom"] = {
        ...index.plugins["my.custom"]!,
        effectiveAtStartup: {
          enabled: true,
          sourceKind: "devOverride",
          version: "0.1.0",
        },
      };
    });

    const result = await syncWorkspaceDevPluginOverrides({
      applyEffective,
      cwd,
      getIndex: () => index,
      setDevOverride,
      specs: [{ devPackageDir: "my-custom-plugin", id: "my.custom" }],
    });

    expect(result.applied).toEqual(["my.custom"]);
    expect(setDevOverride).toHaveBeenCalledWith("my.custom", packageDir);
    expect(applyEffective).toHaveBeenCalledTimes(1);
  });

  it("skips when setDevOverride rejects an unready custom package", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-ws-cwd-"));
    const packageDir = join(cwd, "packages/plugin-grok");
    await mkdir(join(packageDir, "dist"), { recursive: true });
    await writeFile(
      join(packageDir, "plugin.json"),
      JSON.stringify({ id: "pier.grok", version: "1.0.1" })
    );
    await writeFile(join(packageDir, "dist/main.js"), "export {}");

    const setDevOverride = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "invalid_state" as const,
        message: "dev override package invalid",
      },
    }));

    const result = await syncWorkspaceDevPluginOverrides({
      applyEffective: vi.fn(),
      cwd,
      getIndex: () => ({ plugins: {}, version: 1 }),
      setDevOverride,
      specs: [{ devPackageDir: "packages/plugin-grok", id: "pier.grok" }],
    });
    expect(result).toEqual({ applied: [], skipped: ["pier.grok"] });
    expect(setDevOverride).toHaveBeenCalled();
  });

  it("ensureInstalled re-seeds uninstalled workspace plugins then overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-ws-cwd-"));
    const packageDir = join(cwd, "packages/plugin-grok");
    await mkdir(join(packageDir, "dist"), { recursive: true });
    await writeFile(
      join(packageDir, "plugin.json"),
      JSON.stringify({ id: "pier.grok", version: "1.0.1" })
    );
    await writeFile(join(packageDir, "dist/main.js"), "export {}");

    const index: ManagedPluginInstallIndex = {
      plugins: {
        "pier.grok": {
          activeVersion: null,
          devOverride: null,
          effectiveAtStartup: null,
          enabled: false,
          id: "pier.grok",
          installedVersions: {},
          lastKnownGoodVersion: null,
          pendingRestart: null,
          pendingUpdate: null,
          source: { kind: "official" },
          uninstalledAt: 1,
        },
      },
      version: 1,
    };

    const ensureInstalled = vi.fn(async (id: string) => {
      index.plugins[id] = {
        ...index.plugins[id]!,
        activeVersion: "1.0.1",
        enabled: true,
        uninstalledAt: undefined,
        installedVersions: {
          "1.0.1": {
            contentHash: "abc",
            installedAt: 1,
            packageUrl: "bundled://pier.grok/1.0.1",
            sha256: "abc",
          },
        },
      };
      return { ok: true as const, pluginId: id, requiresRestart: false };
    });
    const setDevOverride = vi.fn(async (id: string, path: string) => {
      index.plugins[id] = {
        ...index.plugins[id]!,
        devOverride: { path, registeredAt: 1, version: "1.0.1" },
      };
      return { ok: true as const, pluginId: id, requiresRestart: true };
    });
    const applyEffective = vi.fn(async () => {
      index.plugins["pier.grok"] = {
        ...index.plugins["pier.grok"]!,
        effectiveAtStartup: {
          enabled: true,
          sourceKind: "devOverride",
          version: "1.0.1",
        },
      };
    });

    const result = await syncWorkspaceDevPluginOverrides({
      applyEffective,
      cwd,
      ensureInstalled,
      getIndex: () => index,
      setDevOverride,
      specs: [{ devPackageDir: "packages/plugin-grok", id: "pier.grok" }],
    });

    expect(result.applied).toEqual(["pier.grok"]);
    expect(ensureInstalled).toHaveBeenCalledWith("pier.grok");
    expect(setDevOverride).toHaveBeenCalledWith("pier.grok", packageDir);
    expect(applyEffective).toHaveBeenCalledTimes(1);
  });
});
