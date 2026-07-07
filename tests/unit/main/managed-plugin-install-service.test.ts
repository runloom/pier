import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { createManagedPluginIndexStore } from "@main/services/managed-plugins/index-state.ts";
import {
  createManagedPluginInstallService,
  type ManagedPluginInstallService,
} from "@main/services/managed-plugins/install-service.ts";
import {
  createManagedPluginPaths,
  type ManagedPluginPaths,
} from "@main/services/managed-plugins/paths.ts";
import tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir = "";
let paths: ManagedPluginPaths;

function pluginManifest(version: string): string {
  return JSON.stringify({
    apiVersion: 1,
    commands: [],
    dashboardWidgets: [],
    dataSchemas: { "codex.accounts": { read: ">=1 <=1", write: 1 } },
    engines: { pier: ">=0.1.0 <0.2.0" },
    id: "pier.codex",
    main: "dist/main.js",
    name: "Codex",
    panels: [],
    permissions: [],
    renderer: "dist/renderer.js",
    terminalStatusItems: [],
    version,
  });
}

/**
 * Directory form (used by devOverride tests).
 */
async function createSeedPackage(version = "1.0.0"): Promise<string> {
  const packageDir = join(dir, `seed-dir-${version}`);
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ type: "module" })
  );
  await writeFile(join(packageDir, "plugin.json"), pluginManifest(version));
  await writeFile(
    join(packageDir, "dist/main.js"),
    "export const plugin = { id: 'pier.codex' };\n"
  );
  await writeFile(
    join(packageDir, "dist/renderer.js"),
    "export const plugin = { id: 'pier.codex' };\n"
  );
  return packageDir;
}

/**
 * Tgz form (used by install/uninstall tests). Returns { archivePath, sha256, size }.
 */
async function createSeedArchive(version = "1.0.0"): Promise<{
  archivePath: string;
  sha256: string;
  size: number;
}> {
  const archivePath = join(dir, `seed-${version}.tgz`);
  const members: readonly { name: string; content: string }[] = [
    {
      name: "package.json",
      content: JSON.stringify({ type: "module" }),
    },
    { name: "plugin.json", content: pluginManifest(version) },
    {
      name: "dist/main.js",
      content: "export const plugin = { id: 'pier.codex' };\n",
    },
    {
      name: "dist/renderer.js",
      content: "export const plugin = { id: 'pier.codex' };\n",
    },
  ];
  const pack = tar.pack();
  const gz = createGzip();
  const out = createWriteStream(archivePath);
  const done = pipeline(pack, gz, out);
  for (const m of members) {
    const data = Buffer.from(m.content, "utf8");
    await new Promise<void>((resolveEntry, rejectEntry) => {
      pack.entry({ name: m.name, size: data.length }, data, (err) =>
        err ? rejectEntry(err) : resolveEntry()
      );
    });
  }
  pack.finalize();
  await done;
  const buf = await import("node:fs/promises").then((m) =>
    m.readFile(archivePath)
  );
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const { size } = await stat(archivePath);
  return { archivePath, sha256, size };
}

interface CreateServiceOptions {
  readonly bundledArchive?: {
    archivePath: string;
    sha256: string;
    size: number;
  };
  readonly bundledVersion?: string;
  readonly runtimeMode?: "development" | "production" | "test";
}

async function createService(options: CreateServiceOptions = {}): Promise<{
  service: ManagedPluginInstallService;
  operationLog: ReturnType<typeof vi.fn>;
}> {
  const store = createManagedPluginIndexStore(paths.indexFile);
  const operationLog = vi.fn().mockResolvedValue(undefined);
  const service = createManagedPluginInstallService({
    appendOperationLog: operationLog,
    bundledPlugins: options.bundledArchive
      ? [
          {
            archivePath: options.bundledArchive.archivePath,
            displayName: "Codex",
            id: "pier.codex",
            sha256: options.bundledArchive.sha256,
            size: options.bundledArchive.size,
            version: options.bundledVersion ?? "1.0.0",
          },
        ]
      : [],
    now: () => 1,
    paths,
    pierVersion: "0.1.5",
    runtimeMode: options.runtimeMode ?? "test",
    store,
  });
  await service.init();
  return { service, operationLog };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-install-service-"));
  paths = createManagedPluginPaths(dir);
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("managed plugin install service", () => {
  it("install(id) installs Codex from bundled source", async () => {
    const seed = await createSeedArchive();
    const { service, operationLog } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    const result = await service.install("pier.codex");
    expect(result).toMatchObject({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: false,
      version: "1.0.0",
    });
    const runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources).toHaveLength(1);
    expect(runtimeSources[0]).toMatchObject({
      enabled: true,
      id: "pier.codex",
      kind: "officialInstalled",
      version: "1.0.0",
      rendererEntryUrl: "pier-plugin://pier.codex/1.0.0/dist/renderer.js",
    });
    expect(operationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "install-from-bundle",
        pluginId: "pier.codex",
      })
    );
  });

  it("install is idempotent — second call at same version is a no-op", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await service.install("pier.codex");
    const secondResult = await service.install("pier.codex");
    expect(secondResult).toMatchObject({ ok: true, requiresRestart: false });
  });

  it("disable is next-start: current session still shows plugin as effective", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    const disableResult = await service.disable("pier.codex");
    expect(disableResult).toMatchObject({ ok: true, requiresRestart: true });
    // Still effective in current boot snapshot.
    const runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources[0]).toMatchObject({ enabled: true });
    // After restart: effective flips to disabled.
    await service.simulateRestartForTests();
    const afterRestart = await service.listRuntimeSources();
    expect(afterRestart[0]).toMatchObject({ enabled: false, version: "1.0.0" });
  });

  it("uninstall persists across restart; explicit install clears tombstone", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    await service.uninstall("pier.codex");
    // After restart tombstone is still recorded and runtime source is empty.
    await service.simulateRestartForTests();
    let runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources).toEqual([]);
    let index = service.getIndex();
    expect(index.plugins["pier.codex"]?.uninstalledAt).toBe(1);
    // User-initiated install clears the tombstone and reinstalls.
    const result = await service.install("pier.codex");
    expect(result).toMatchObject({ ok: true, version: "1.0.0" });
    await service.simulateRestartForTests();
    runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources[0]).toMatchObject({
      id: "pier.codex",
      version: "1.0.0",
    });
    index = service.getIndex();
    expect(index.plugins["pier.codex"]?.uninstalledAt).toBeFalsy();
  });

  it("setDevOverride and clearDevOverride succeed in test runtime", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "test",
    });
    await service.install("pier.codex");
    const devPackageDir = await createSeedPackage("1.0.1");
    const setResult = await service.setDevOverride("pier.codex", devPackageDir);
    expect(setResult).toMatchObject({ ok: true, requiresRestart: true });
    await service.simulateRestartForTests();
    const runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources[0]).toMatchObject({
      kind: "devOverride",
      version: "1.0.1",
    });
    // Clear dev override
    await service.clearDevOverride("pier.codex");
    await service.simulateRestartForTests();
    const afterClear = await service.listRuntimeSources();
    expect(afterClear[0]).toMatchObject({
      kind: "officialInstalled",
      version: "1.0.0",
    });
  });

  it("setDevOverride returns denied in production runtime, does not mutate state", async () => {
    const seed = await createSeedArchive();
    const { service, operationLog } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await service.install("pier.codex");
    const devPackageDir = await createSeedPackage("1.0.1");
    const result = await service.setDevOverride("pier.codex", devPackageDir);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "denied" },
    });
    expect(operationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "devOverride.set",
        result: "denied",
      })
    );
    // State was not mutated.
    const index = service.getIndex();
    expect(index.plugins["pier.codex"]?.devOverride).toBeNull();
  });

  it("production init ignores persisted devOverride path without reading it", async () => {
    // Seed the store with a devOverride record from a previous dev session.
    await mkdir(paths.pluginsDir, { recursive: true });
    await writeFile(
      paths.indexFile,
      JSON.stringify({
        version: 1,
        plugins: {
          "pier.codex": {
            activeVersion: "1.0.0",
            devOverride: {
              path: "/nonexistent/dev/codex",
              registeredAt: 100,
              version: "1.0.0",
            },
            effectiveAtStartup: {
              enabled: true,
              sourceKind: "official",
              version: "1.0.0",
            },
            enabled: true,
            id: "pier.codex",
            installedVersions: {
              "1.0.0": {
                installedAt: 1,
                packageUrl: "bundled://x",
                sha256: "h",
              },
            },
            pendingRestart: null,
            pendingUpdate: null,
            source: { kind: "official" },
          },
        },
      })
    );
    const { service } = await createService({ runtimeMode: "production" });
    const index = service.getIndex();
    expect(index.plugins["pier.codex"]?.devOverride).toBeNull();
  });

  it("recordActivationResult advances lastKnownGoodVersion after main+renderer success", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    await service.recordActivationResult({
      ok: true,
      phase: "main",
      pluginId: "pier.codex",
      version: "1.0.0",
    });
    await service.recordActivationResult({
      ok: true,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.0",
      windowId: "window-1",
    });
    // Duplicate report for same window does not re-advance / cause errors.
    await service.recordActivationResult({
      ok: true,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.0",
      windowId: "window-1",
    });
    const index = service.getIndex();
    expect(index.plugins["pier.codex"]?.lastKnownGoodVersion).toBe("1.0.0");
  });

  it("recordActivationResult does NOT advance lastKnownGoodVersion after any failure", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    await service.recordActivationResult({
      ok: true,
      phase: "main",
      pluginId: "pier.codex",
      version: "1.0.0",
    });
    await service.recordActivationResult({
      ok: false,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.0",
      windowId: "window-1",
    });
    // Second window succeeds later — but earlier failure poisons the version.
    await service.recordActivationResult({
      ok: true,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.0",
      windowId: "window-2",
    });
    const index = service.getIndex();
    expect(
      index.plugins["pier.codex"]?.lastKnownGoodVersion ?? null
    ).toBeNull();
  });

  it("listCatalogSnapshot combines index desired state and official index availability", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    const snapshot = await service.listCatalogSnapshot();
    expect(snapshot.plugins).toHaveLength(1);
    expect(snapshot.plugins[0]).toMatchObject({
      id: "pier.codex",
      installed: true,
      desired: { enabled: true, source: "official", version: "1.0.0" },
      effective: { enabled: true, source: "official", version: "1.0.0" },
      pendingRestart: null,
      update: null,
    });
  });

  it("index state persists across service restart", async () => {
    const seed = await createSeedArchive("1.0.0");
    const store1 = createManagedPluginIndexStore(paths.indexFile);
    const svc1 = createManagedPluginInstallService({
      appendOperationLog: vi.fn().mockResolvedValue(undefined),
      bundledPlugins: [
        {
          archivePath: seed.archivePath,
          displayName: "Codex",
          id: "pier.codex",
          sha256: seed.sha256,
          size: seed.size,
          version: "1.0.0",
        },
      ],
      now: () => 1,
      paths,
      pierVersion: "0.1.5",
      runtimeMode: "test",
      store: store1,
    });
    await svc1.init();
    await svc1.install("pier.codex");
    // Fresh service instance reading same file.
    const store2 = createManagedPluginIndexStore(paths.indexFile);
    const svc2 = createManagedPluginInstallService({
      appendOperationLog: vi.fn().mockResolvedValue(undefined),
      now: () => 2,
      paths,
      pierVersion: "0.1.5",
      runtimeMode: "test",
      store: store2,
    });
    await svc2.init();
    const runtimeSources = await svc2.listRuntimeSources();
    expect(runtimeSources).toHaveLength(1);
    expect(runtimeSources[0]).toMatchObject({
      id: "pier.codex",
      version: "1.0.0",
    });
  });
});
