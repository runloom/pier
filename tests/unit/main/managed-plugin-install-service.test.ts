import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
import type { OfficialPluginIndex } from "@shared/contracts/managed-plugin.ts";
import tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir = "";
let paths: ManagedPluginPaths;

function pluginManifest(
  version: string,
  runtime?: { reloadPolicy: "hot" | "restart" }
): string {
  return JSON.stringify({
    apiVersion: 1,
    commands: [],
    missionControlWidgets: [],
    dataSchemas: { "codex.accounts": { read: ">=1 <=1", write: 1 } },
    engines: { pier: ">=0.1.0 <0.2.0" },
    id: "pier.codex",
    main: "dist/main.js",
    name: "Codex",
    panels: [],
    permissions: [],
    renderer: "dist/renderer.js",
    ...(runtime ? { runtime } : {}),
    terminalStatusItems: [],
    version,
  });
}

/**
 * Directory form (used by devOverride tests).
 */
async function createSeedPackage(
  version = "1.0.0",
  runtime?: { reloadPolicy: "hot" | "restart" }
): Promise<string> {
  const packageDir = join(dir, `seed-dir-${version}`);
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ type: "module" })
  );
  await writeFile(
    join(packageDir, "plugin.json"),
    pluginManifest(version, runtime)
  );
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
async function createSeedArchive(
  version = "1.0.0",
  runtime?: { reloadPolicy: "hot" | "restart" }
): Promise<{
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
    { name: "plugin.json", content: pluginManifest(version, runtime) },
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
  readonly assetFetcher?: (
    url: string
  ) => Promise<{ body: Buffer; finalUrl: string; redirectCount: number }>;
  readonly bundledArchive?: {
    archivePath: string;
    sha256: string;
    size: number;
  };
  readonly bundledVersion?: string;
  readonly expectedRendererWindowIds?: () => readonly string[];
  readonly officialIndex?: OfficialPluginIndex | null;
  readonly officialIndexProvider?: () => OfficialPluginIndex | null;
  readonly officialIndexRefresh?: (options?: {
    force?: boolean;
  }) => Promise<void>;
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
    ...(options.assetFetcher ? { assetFetcher: options.assetFetcher } : {}),
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
    ...(options.expectedRendererWindowIds
      ? { expectedRendererWindowIds: options.expectedRendererWindowIds }
      : {}),
    now: () => 1,
    officialIndexProvider:
      options.officialIndexProvider ?? (() => options.officialIndex ?? null),
    ...(options.officialIndexRefresh
      ? { officialIndexRefresh: options.officialIndexRefresh }
      : {}),
    paths,
    pierVersion: "0.1.5",
    runtimeMode: options.runtimeMode ?? "test",
    store,
  });
  await service.init();
  return { service, operationLog };
}

function officialIndexFor(
  version: string,
  archive: { sha256: string; size: number }
): OfficialPluginIndex {
  return {
    generatedAt: 1,
    plugins: {
      "pier.codex": {
        displayName: "Codex",
        id: "pier.codex",
        latest: version,
        versions: {
          [version]: {
            assetUrl: `https://github.com/runloom/pier/releases/download/pier.codex-${version}/pier.codex.tgz`,
            pier: ">=0.1.0 <0.2.0",
            sha256: archive.sha256,
            size: archive.size,
          },
        },
      },
    },
    sequence: 7,
    signature: { alg: "Ed25519", keyId: "test", value: "test" },
    version: 1,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-install-service-"));
  paths = createManagedPluginPaths(dir);
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("managed plugin install service", () => {
  it("checkUpdates refreshes the official index before deriving the catalog", async () => {
    const seed = await createSeedArchive("1.0.1");
    let currentIndex: OfficialPluginIndex | null = null;
    const officialIndexRefresh = vi.fn(async () => {
      currentIndex = officialIndexFor("1.0.1", seed);
    });
    const { service } = await createService({
      officialIndexProvider: () => currentIndex,
      officialIndexRefresh,
      runtimeMode: "production",
    });

    expect((await service.listCatalogSnapshot()).plugins).toHaveLength(0);

    const result = await service.checkUpdates();

    expect(officialIndexRefresh).toHaveBeenCalledWith({ force: true });
    expect(result.plugins[0]).toMatchObject({
      id: "pier.codex",
      installed: false,
      update: { version: "1.0.1" },
    });
  });

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
    });
    expect(runtimeSources[0]?.rendererEntryUrl).toBe(
      `pier-plugin://pier.codex/1.0.0/dist/renderer.js?rev=${runtimeSources[0]?.sourceRevision}`
    );
    expect(operationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "install-from-bundle",
        pluginId: "pier.codex",
      })
    );
  });

  it("prefers a newer bundled version over an older official index asset", async () => {
    const officialSeed = await createSeedArchive("1.0.5");
    const bundledSeed = await createSeedArchive("1.1.0");
    const assetFetcher = vi.fn(async () => ({
      body: await readFile(officialSeed.archivePath),
      finalUrl: "https://example.test/pier.codex-1.0.5.tgz",
      redirectCount: 0,
    }));
    const { service, operationLog } = await createService({
      assetFetcher,
      bundledArchive: bundledSeed,
      bundledVersion: "1.1.0",
      officialIndex: officialIndexFor("1.0.5", officialSeed),
    });

    expect((await service.listCatalogSnapshot()).plugins[0]?.update).toEqual({
      version: "1.1.0",
    });
    await expect(service.install("pier.codex")).resolves.toMatchObject({
      ok: true,
      version: "1.1.0",
    });
    expect(assetFetcher).not.toHaveBeenCalled();
    expect(operationLog).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "install-from-bundle" })
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

  it("updating an installed plugin marks the new version as pending restart", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1");
    const { service: sameBootSession } = await createService({
      bundledArchive: seedV2,
      bundledVersion: "1.0.1",
      runtimeMode: "production",
    });

    const updateResult = await sameBootSession.install("pier.codex");

    expect(updateResult).toMatchObject({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: true,
      version: "1.0.1",
    });
    const index = sameBootSession.getIndex();
    expect(index.plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.1",
      effectiveAtStartup: {
        enabled: true,
        sourceKind: "official",
        version: "1.0.0",
      },
      pendingRestart: { kind: "update", version: "1.0.1" },
    });
    const catalog = await sameBootSession.listCatalogSnapshot();
    expect(catalog.plugins[0]?.pendingRestart).toEqual({
      kind: "update",
      version: "1.0.1",
    });
  });

  it("update(id) downloads official latest and keeps current runtime effective until restart", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1");
    const body = await readFile(seedV2.archivePath);
    const assetFetcher = vi.fn(async (_url: string) => ({
      body,
      finalUrl:
        "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
      redirectCount: 0,
    }));
    const officialIndexRefresh = vi.fn().mockResolvedValue(undefined);
    const { service, operationLog } = await createService({
      assetFetcher,
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh,
      runtimeMode: "production",
    });

    const result = await service.update("pier.codex");

    expect(result).toMatchObject({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: true,
      version: "1.0.1",
    });
    expect(officialIndexRefresh).toHaveBeenCalledTimes(1);
    expect(assetFetcher).toHaveBeenCalledWith(
      "https://github.com/runloom/pier/releases/download/pier.codex-1.0.1/pier.codex.tgz"
    );
    expect(service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.1",
      effectiveAtStartup: {
        enabled: true,
        sourceKind: "official",
        version: "1.0.0",
      },
      pendingRestart: { kind: "update", version: "1.0.1" },
    });
    expect((await service.listRuntimeSources())[0]).toMatchObject({
      id: "pier.codex",
      version: "1.0.0",
    });
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
      windowId: "window-main",
    });
    expect(service.getIndex().plugins["pier.codex"]?.lastKnownGoodVersion).toBe(
      "1.0.0"
    );
    await service.recordActivationResult({
      ok: true,
      phase: "main",
      pluginId: "pier.codex",
      version: "1.0.1",
    });
    await service.recordActivationResult({
      ok: true,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.1",
      windowId: "window-main",
    });
    expect(service.getIndex().plugins["pier.codex"]?.lastKnownGoodVersion).toBe(
      "1.0.0"
    );
    expect(operationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetUrl:
          "https://github.com/runloom/pier/releases/download/pier.codex-1.0.1/pier.codex.tgz",
        fromVersion: "1.0.0",
        officialIndexSequence: 7,
        operation: "update",
        pluginId: "pier.codex",
        result: "success",
        sha256: seedV2.sha256,
        toVersion: "1.0.1",
      })
    );
  });

  it("update(id) immediately switches runtime when the target package declares hot reload", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1", {
      reloadPolicy: "hot",
    });
    const body = await readFile(seedV2.archivePath);
    const { service } = await createService({
      assetFetcher: vi.fn(async (_url: string) => ({
        body,
        finalUrl:
          "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
        redirectCount: 0,
      })),
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });

    const result = await service.update("pier.codex");

    expect(result).toMatchObject({
      ok: true,
      requiresRestart: false,
      version: "1.0.1",
    });
    expect(service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.1",
      effectiveAtStartup: {
        enabled: true,
        sourceKind: "official",
        version: "1.0.1",
      },
      pendingRestart: null,
    });
    expect((await service.listRuntimeSources())[0]).toMatchObject({
      id: "pier.codex",
      version: "1.0.1",
    });
  });

  it("update(id) fails without falling back to bundled archives when official asset verification fails", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1");
    const assetFetcher = vi.fn(async (_url: string) => ({
      body: Buffer.from("not the official plugin package"),
      finalUrl:
        "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
      redirectCount: 0,
    }));
    const { service, operationLog } = await createService({
      assetFetcher,
      bundledArchive: seedV1,
      bundledVersion: "9.9.9",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });

    const result = await service.update("pier.codex");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "hash_mismatch" },
    });
    expect(service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.0",
      pendingRestart: null,
    });
    expect(
      service.getIndex().plugins["pier.codex"]?.installedVersions
    ).not.toHaveProperty("9.9.9");
    expect(operationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update",
        pluginId: "pier.codex",
        result: "failed",
      })
    );
  });

  it("disable and enable update the current runtime snapshot immediately", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    const disableResult = await service.disable("pier.codex");
    expect(disableResult).toMatchObject({ ok: true, requiresRestart: false });
    const runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources[0]).toMatchObject({
      enabled: false,
      version: "1.0.0",
    });

    const enableResult = await service.enable("pier.codex");
    expect(enableResult).toMatchObject({ ok: true, requiresRestart: false });
    const afterEnable = await service.listRuntimeSources();
    expect(afterEnable[0]).toMatchObject({
      enabled: true,
      version: "1.0.0",
    });
  });

  it("disable and enable preserve pending restart when an update version is not yet effective", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1");
    const body = await readFile(seedV2.archivePath);
    const { service } = await createService({
      assetFetcher: vi.fn(async (_url: string) => ({
        body,
        finalUrl:
          "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
        redirectCount: 0,
      })),
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });
    await service.update("pier.codex");

    await service.disable("pier.codex");

    expect(service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.1",
      effectiveAtStartup: {
        enabled: false,
        sourceKind: "official",
        version: "1.0.0",
      },
      pendingRestart: { kind: "update", version: "1.0.1" },
    });
    expect((await service.listRuntimeSources())[0]).toMatchObject({
      enabled: false,
      version: "1.0.0",
    });

    await service.enable("pier.codex");

    expect(service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.1",
      effectiveAtStartup: {
        enabled: true,
        sourceKind: "official",
        version: "1.0.0",
      },
      pendingRestart: { kind: "update", version: "1.0.1" },
    });
    expect((await service.listCatalogSnapshot()).plugins[0]).toMatchObject({
      pendingRestart: { kind: "update", version: "1.0.1" },
    });
  });

  it("disable preserves pending restart when a rollback version is not yet effective", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1", {
      reloadPolicy: "hot",
    });
    const body = await readFile(seedV2.archivePath);
    const { service } = await createService({
      assetFetcher: vi.fn(async (_url: string) => ({
        body,
        finalUrl:
          "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
        redirectCount: 0,
      })),
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });
    await service.update("pier.codex");
    await service.rollback("pier.codex", "1.0.0");

    await service.disable("pier.codex");

    expect(service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: "1.0.0",
      effectiveAtStartup: {
        enabled: false,
        sourceKind: "official",
        version: "1.0.1",
      },
      pendingRestart: { kind: "rollback", version: "1.0.0" },
    });
    expect((await service.listRuntimeSources())[0]).toMatchObject({
      enabled: false,
      version: "1.0.1",
    });
  });

  it("rejects rollback when the recorded installed package was modified", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const { service: firstSession } = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await firstSession.install("pier.codex");

    const seedV2 = await createSeedArchive("1.0.1", {
      reloadPolicy: "hot",
    });
    const body = await readFile(seedV2.archivePath);
    const { service } = await createService({
      assetFetcher: vi.fn(async (_url: string) => ({
        body,
        finalUrl:
          "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
        redirectCount: 0,
      })),
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });
    await service.update("pier.codex");
    await writeFile(
      join(paths.installedDir, "pier.codex", "1.0.0", "dist/main.js"),
      "export const plugin = { id: 'pier.codex', tampered: true };\n"
    );

    const result = await service.rollback("pier.codex", "1.0.0");

    expect(result).toMatchObject({
      error: { code: "invalid_state" },
      ok: false,
    });
    expect(service.getIndex().plugins["pier.codex"]?.activeVersion).toBe(
      "1.0.1"
    );
  });

  it("uninstall removes the current runtime source immediately; explicit install clears tombstone", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await service.install("pier.codex");
    const uninstallResult = await service.uninstall("pier.codex");
    expect(uninstallResult).toMatchObject({
      ok: true,
      requiresRestart: false,
    });
    let runtimeSources = await service.listRuntimeSources();
    expect(runtimeSources).toEqual([]);
    let index = service.getIndex();
    expect(index.plugins["pier.codex"]?.effectiveAtStartup).toBeNull();
    expect(index.plugins["pier.codex"]?.uninstalledAt).toBe(1);
    // User-initiated install clears the tombstone and reinstalls.
    const result = await service.install("pier.codex");
    expect(result).toMatchObject({ ok: true, version: "1.0.0" });
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

  it("dev override runtime source includes a source revision and cache-busted renderer URL", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "test",
    });
    await service.install("pier.codex");
    const devPackageDir = await createSeedPackage("1.0.1");
    await service.setDevOverride("pier.codex", devPackageDir);
    await service.simulateRestartForTests();

    const runtimeSources = await service.listRuntimeSources();

    expect(runtimeSources[0]?.sourceRevision).toMatch(/^[a-f0-9]{12}$/);
    expect(runtimeSources[0]?.rendererEntryUrl).toBe(
      `pier-plugin://pier.codex/1.0.1/dist/renderer.js?rev=${runtimeSources[0]?.sourceRevision}`
    );
  });

  it("refreshRuntimeSources recomputes dev source revisions after package files change", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "test",
    });
    await service.install("pier.codex");
    const devPackageDir = await createSeedPackage("1.0.1");
    await service.setDevOverride("pier.codex", devPackageDir);
    await service.simulateRestartForTests();
    const before = (await service.listRuntimeSources())[0]?.sourceRevision;

    await writeFile(
      join(devPackageDir, "dist/renderer.js"),
      "export const plugin = { id: 'pier.codex', changed: true };\n"
    );
    await service.refreshRuntimeSources();

    const after = (await service.listRuntimeSources())[0]?.sourceRevision;
    expect(after).toMatch(/^[a-f0-9]{12}$/);
    expect(after).not.toBe(before);
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

  it("refuses to materialize an installed plugin after package content is modified", async () => {
    const seed = await createSeedArchive();
    const first = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await first.service.install("pier.codex");
    await writeFile(
      join(paths.installedDir, "pier.codex", "1.0.0", "dist/main.js"),
      "export const plugin = { id: 'tampered' };\n"
    );

    const second = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await expect(second.service.listRuntimeSources()).resolves.toEqual([]);
  });

  it("migrates a legacy installed record by rematerializing its trusted bundle", async () => {
    const seed = await createSeedArchive();
    const first = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await first.service.install("pier.codex");
    const legacyIndex = JSON.parse(
      await readFile(paths.indexFile, "utf8")
    ) as Record<string, unknown>;
    const plugins = legacyIndex.plugins as Record<
      string,
      { installedVersions: Record<string, { contentHash?: string }> }
    >;
    const legacyRecord = plugins["pier.codex"]?.installedVersions["1.0.0"];
    if (legacyRecord) {
      const { contentHash: _contentHash, ...withoutContentHash } = legacyRecord;
      plugins["pier.codex"]!.installedVersions["1.0.0"] = withoutContentHash;
    }
    await writeFile(paths.indexFile, JSON.stringify(legacyIndex));
    await writeFile(
      join(paths.installedDir, "pier.codex", "1.0.0", "dist/main.js"),
      "tampered legacy content"
    );

    const second = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    expect(
      second.service.getIndex().plugins["pier.codex"]?.installedVersions[
        "1.0.0"
      ]?.contentHash
    ).toMatch(/^[a-f0-9]{64}$/);
    await expect(second.service.listRuntimeSources()).resolves.toHaveLength(1);
  });

  it("quarantines a legacy official version that cannot be re-established from a trusted bundle", async () => {
    const seedV1 = await createSeedArchive("1.0.0");
    const first = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await first.service.install("pier.codex");
    const seedV2 = await createSeedArchive("1.0.1", {
      reloadPolicy: "hot",
    });
    const body = await readFile(seedV2.archivePath);
    const updater = await createService({
      assetFetcher: vi.fn(async () => ({
        body,
        finalUrl:
          "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
        redirectCount: 0,
      })),
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.1", seedV2),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });
    await updater.service.update("pier.codex");
    const legacyIndex = JSON.parse(await readFile(paths.indexFile, "utf8")) as {
      plugins: Record<
        string,
        { installedVersions: Record<string, { contentHash?: string }> }
      >;
    };
    const v2 = legacyIndex.plugins["pier.codex"]?.installedVersions["1.0.1"];
    if (v2) {
      const { contentHash: _contentHash, ...withoutContentHash } = v2;
      legacyIndex.plugins["pier.codex"]!.installedVersions["1.0.1"] =
        withoutContentHash;
    }
    await writeFile(paths.indexFile, JSON.stringify(legacyIndex));

    const restarted = await createService({
      bundledArchive: seedV1,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });

    expect(restarted.service.getIndex().plugins["pier.codex"]).toMatchObject({
      activeVersion: null,
      effectiveAtStartup: null,
      enabled: false,
    });
    expect(
      restarted.service.getIndex().plugins["pier.codex"]?.installedVersions[
        "1.0.1"
      ]
    ).toBeUndefined();
    await expect(
      readFile(join(paths.installedDir, "pier.codex", "1.0.1", "dist/main.js"))
    ).rejects.toThrow();
    await expect(restarted.service.listRuntimeSources()).resolves.toEqual([]);
  });

  it("repairs a modified current version when install would otherwise be a no-op", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await service.install("pier.codex");
    const mainEntry = join(
      paths.installedDir,
      "pier.codex",
      "1.0.0",
      "dist/main.js"
    );
    await writeFile(mainEntry, "tampered current version");

    await expect(service.install("pier.codex")).resolves.toMatchObject({
      ok: true,
      version: "1.0.0",
    });
    await expect(readFile(mainEntry, "utf8")).resolves.toContain(
      "export const plugin"
    );
  });

  it("repairs a modified current version through same-version update", async () => {
    const seed = await createSeedArchive();
    const first = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      runtimeMode: "production",
    });
    await first.service.install("pier.codex");
    const mainEntry = join(
      paths.installedDir,
      "pier.codex",
      "1.0.0",
      "dist/main.js"
    );
    await writeFile(mainEntry, "tampered current version");
    const body = await readFile(seed.archivePath);
    const updater = await createService({
      assetFetcher: vi.fn(async () => ({
        body,
        finalUrl:
          "https://objects.githubusercontent.com/github-production-release-asset/test/pier.codex.tgz",
        redirectCount: 0,
      })),
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      officialIndex: officialIndexFor("1.0.0", seed),
      officialIndexRefresh: vi.fn().mockResolvedValue(undefined),
      runtimeMode: "production",
    });

    await expect(updater.service.update("pier.codex")).resolves.toMatchObject({
      ok: true,
      version: "1.0.0",
    });
    await expect(readFile(mainEntry, "utf8")).resolves.toContain(
      "export const plugin"
    );
  });

  it("checks persisted data schema compatibility again at runtime materialization", async () => {
    const seed = await createSeedArchive();
    const first = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await first.service.install("pier.codex");
    const pluginWorkDir = join(paths.workDir, "pier.codex");
    await mkdir(pluginWorkDir, { recursive: true });
    await writeFile(
      join(pluginWorkDir, ".pier-plugin-data-schemas.json"),
      JSON.stringify({
        schemas: { "codex.accounts": { version: 2 } },
        version: 1,
      })
    );

    const second = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
    });
    await expect(second.service.listRuntimeSources()).resolves.toEqual([]);
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

  it("waits for every expected renderer window before advancing lastKnownGoodVersion", async () => {
    const seed = await createSeedArchive();
    const { service } = await createService({
      bundledArchive: seed,
      bundledVersion: "1.0.0",
      expectedRendererWindowIds: () => ["window-1", "window-2"],
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
    expect(
      service.getIndex().plugins["pier.codex"]?.lastKnownGoodVersion ?? null
    ).toBeNull();

    await service.recordActivationResult({
      ok: true,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.0",
      windowId: "window-2",
    });
    expect(service.getIndex().plugins["pier.codex"]?.lastKnownGoodVersion).toBe(
      "1.0.0"
    );

    await service.recordActivationResult({
      ok: false,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.0",
      windowId: "window-2",
    });
    expect(
      service.getIndex().plugins["pier.codex"]?.lastKnownGoodVersion ?? null
    ).toBeNull();
  });

  it("serializes concurrent success and failure activation reports", async () => {
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
    await Promise.all([
      service.recordActivationResult({
        ok: true,
        phase: "renderer",
        pluginId: "pier.codex",
        version: "1.0.0",
        windowId: "window-1",
      }),
      service.recordActivationResult({
        ok: false,
        phase: "renderer",
        pluginId: "pier.codex",
        version: "1.0.0",
        windowId: "window-2",
      }),
    ]);
    expect(
      service.getIndex().plugins["pier.codex"]?.lastKnownGoodVersion ?? null
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
