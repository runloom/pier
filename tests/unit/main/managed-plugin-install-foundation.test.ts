import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { createManagedPluginIndexStore } from "@main/services/managed-plugins/index-state.ts";
import {
  downloadOfficialPluginAsset,
  fetchOfficialPluginIndex,
  selectLatestCompatibleVersion,
  validateOfficialAssetRedirect,
} from "@main/services/managed-plugins/official-index.ts";
import {
  extractTgzSafely,
  MANAGED_PLUGIN_PACKAGE_LIMITS,
  validateManagedPluginPackage,
} from "@main/services/managed-plugins/package-validation.ts";
import { createManagedPluginPaths } from "@main/services/managed-plugins/paths.ts";
import * as tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-managed-plugins-"));
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

interface TgzEntry {
  content: string;
  linkname?: string;
  path: string;
  type?: "file" | "link" | "symlink";
}

async function createTgzFixture(
  archivePath: string,
  entries: readonly TgzEntry[]
): Promise<void> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const gzip = createGzip();
  gzip.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>((resolve, reject) => {
    gzip.on("end", () => resolve());
    gzip.on("error", reject);
  });
  pack.pipe(gzip);
  for (const entry of entries) {
    pack.entry(
      {
        name: entry.path,
        type: entry.type ?? "file",
        linkname: entry.linkname,
      },
      entry.content
    );
  }
  pack.finalize();
  await finished;
  await writeFile(archivePath, Buffer.concat(chunks));
}

async function createPackage(version = "1.0.0"): Promise<string> {
  const packageDir = join(dir, "package");
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ type: "module" })
  );
  await writeFile(
    join(packageDir, "plugin.json"),
    JSON.stringify({
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
      terminalStatusItems: [],
      version,
    })
  );
  await writeFile(
    join(packageDir, "dist/main.js"),
    "import { join } from 'node:path';\nexport const plugin = { id: 'pier.codex' };\n"
  );
  await writeFile(
    join(packageDir, "dist/renderer.js"),
    "export const plugin = { id: 'pier.codex' };\n"
  );
  return packageDir;
}

describe("managed plugin install foundation", () => {
  it("derives userData plugin paths", () => {
    expect(createManagedPluginPaths("/tmp/pier")).toMatchObject({
      indexFile: "/tmp/pier/plugins/index.json",
      installedDir: "/tmp/pier/plugins/installed",
      stagingDir: "/tmp/pier/plugins/staging",
      workDir: "/tmp/pier/plugins/work",
    });
  });

  it("persists the install index", async () => {
    const store = createManagedPluginIndexStore(
      join(dir, "plugins/index.json")
    );
    await store.init();
    store.mutate((state) => ({
      ...state,
      plugins: {
        "pier.codex": {
          activeVersion: "1.0.0",
          devOverride: null,
          enabled: true,
          effectiveAtStartup: {
            version: "1.0.0",
            enabled: true,
            sourceKind: "official",
          },
          id: "pier.codex",
          installedVersions: {
            "1.0.0": {
              installedAt: 1,
              packageUrl: "bundled://pier.codex/1.0.0",
              sha256: "seed",
            },
          },
          pendingRestart: null,
          pendingUpdate: null,
          source: { kind: "official", seededFromBundle: true },
        },
      },
    }));
    await store.flush();
    const persisted = JSON.parse(
      await readFile(join(dir, "plugins/index.json"), "utf8")
    ) as { plugins: Record<string, { enabled: boolean }> };
    expect(persisted.plugins["pier.codex"]?.enabled).toBe(true);
  });

  it("validates manifest id, version, engine compatibility, and entries", async () => {
    await expect(
      validateManagedPluginPackage({
        packageDir: await createPackage(),
        archivePath: null,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: null,
        pierVersion: "0.1.0",
      })
    ).resolves.toMatchObject({ manifest: { id: "pier.codex" } });
    await expect(
      validateManagedPluginPackage({
        packageDir: await createPackage(),
        archivePath: null,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: null,
        pierVersion: "0.2.0",
      })
    ).rejects.toThrow(/incompatible Pier version/);
  });

  it("extracts a safe package archive under staging", async () => {
    const archivePath = join(dir, "safe.tgz");
    await createTgzFixture(archivePath, [
      { path: "package.json", content: JSON.stringify({ type: "module" }) },
      {
        path: "plugin.json",
        content: JSON.stringify({
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
          terminalStatusItems: [],
          version: "1.0.0",
        }),
      },
      { path: "dist/main.js", content: "export const plugin = {};\n" },
      { path: "dist/renderer.js", content: "export const plugin = {};\n" },
    ]);
    const extractedDir = await extractTgzSafely(
      archivePath,
      join(dir, "staging-safe")
    );
    expect(
      await readFile(join(extractedDir, "package.json"), "utf8")
    ).toContain("module");
    expect(await readFile(join(extractedDir, "plugin.json"), "utf8")).toContain(
      "pier.codex"
    );
  });

  it("rejects unsafe archive member paths before extraction", async () => {
    const archivePath = join(dir, "unsafe.tgz");
    await createTgzFixture(archivePath, [
      { path: "../escape.txt", content: "bad" },
    ]);
    await expect(
      extractTgzSafely(archivePath, join(dir, "staging-unsafe"))
    ).rejects.toThrow(/unsafe archive member/);
    await expect(readFile(join(dir, "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("rejects absolute archive member paths", async () => {
    const archivePath = join(dir, "absolute.tgz");
    await createTgzFixture(archivePath, [
      { path: "/tmp/escape.txt", content: "bad" },
    ]);
    await expect(
      extractTgzSafely(archivePath, join(dir, "staging-abs"))
    ).rejects.toThrow(/unsafe archive member/);
  });

  it("rejects symlink and hardlink archive entries", async () => {
    const symlinkArchive = join(dir, "symlink.tgz");
    await createTgzFixture(symlinkArchive, [
      {
        path: "plugin/link",
        content: "",
        type: "symlink",
        linkname: "../escape",
      },
    ]);
    await expect(
      extractTgzSafely(symlinkArchive, join(dir, "staging-symlink"))
    ).rejects.toThrow(/links are not allowed/);
    const hardlinkArchive = join(dir, "hardlink.tgz");
    await createTgzFixture(hardlinkArchive, [
      { path: "plugin/link", content: "", type: "link", linkname: "../escape" },
    ]);
    await expect(
      extractTgzSafely(hardlinkArchive, join(dir, "staging-hardlink"))
    ).rejects.toThrow(/links are not allowed/);
  });

  it("exposes production-safe archive limits", () => {
    expect(MANAGED_PLUGIN_PACKAGE_LIMITS).toMatchObject({
      maxDepth: expect.any(Number),
      maxEntries: expect.any(Number),
      maxPathLength: expect.any(Number),
      maxTotalUncompressedBytes: expect.any(Number),
    });
  });

  it("rejects hash mismatch and size mismatch during package validation", async () => {
    const archivePath = join(dir, "plugin.tgz");
    await createTgzFixture(archivePath, [
      { path: "plugin.json", content: "{}" },
    ]);
    await expect(
      validateManagedPluginPackage({
        packageDir: await createPackage(),
        archivePath,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: "wrong",
        expectedSize: null,
        pierVersion: "0.1.0",
      })
    ).rejects.toThrow(/sha256 mismatch/);
    await expect(
      validateManagedPluginPackage({
        packageDir: await createPackage(),
        archivePath,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: 999_999,
        pierVersion: "0.1.0",
      })
    ).rejects.toThrow(/size mismatch/);
  });

  it("rejects packages without ESM marker", async () => {
    const nonEsmPackage = await createPackage();
    await writeFile(
      join(nonEsmPackage, "package.json"),
      JSON.stringify({ type: "commonjs" })
    );
    await expect(
      validateManagedPluginPackage({
        packageDir: nonEsmPackage,
        archivePath: null,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: null,
        pierVersion: "0.1.0",
      })
    ).rejects.toThrow(/ESM package marker/);
  });

  it("rejects packages with unresolved bare imports in renderer bundle", async () => {
    const rendererBarePackage = await createPackage();
    await writeFile(
      join(rendererBarePackage, "dist/renderer.js"),
      "import React from 'react';\nexport const plugin = {};\n"
    );
    await expect(
      validateManagedPluginPackage({
        packageDir: rendererBarePackage,
        archivePath: null,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: null,
        pierVersion: "0.1.0",
      })
    ).rejects.toThrow(/unresolved renderer import/);
  });

  it("rejects packages that use eval or new Function", async () => {
    const rendererEvalPackage = await createPackage();
    await writeFile(
      join(rendererEvalPackage, "dist/renderer.js"),
      "export const plugin = { activate() { return new Function('return 1')(); } };\n"
    );
    await expect(
      validateManagedPluginPackage({
        packageDir: rendererEvalPackage,
        archivePath: null,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: null,
        pierVersion: "0.1.0",
      })
    ).rejects.toThrow(/eval is not allowed/);
  });

  it("rejects packages with unresolved bare imports in main bundle", async () => {
    const mainBarePackage = await createPackage();
    await writeFile(
      join(mainBarePackage, "dist/main.js"),
      "import x from 'write-file-atomic';\nexport const plugin = {};\n"
    );
    await expect(
      validateManagedPluginPackage({
        packageDir: mainBarePackage,
        archivePath: null,
        expectedId: "pier.codex",
        expectedVersion: "1.0.0",
        expectedSha256: null,
        expectedSize: null,
        pierVersion: "0.1.0",
      })
    ).rejects.toThrow(/unresolved main import/);
  });

  it("returns stale cache when env override + network unavailable in dev runtime", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache.json");
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        highestSequence: 1,
        versionHashes: {},
        index: {
          generatedAt: 1,
          plugins: {},
          sequence: 1,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        },
      })
    );
    const result = await fetchOfficialPluginIndex({
      cachePath,
      env: {
        PIER_OFFICIAL_PLUGIN_INDEX_URL: "https://example.test/index.json",
      },
      runtimeMode: "development",
      fetchRawJson: async () => {
        throw new Error("offline");
      },
    });
    expect(result.source).toBe("cache");
    expect(result.index?.sequence).toBe(1);
    expect(result.diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  it("ignores official index URL override in production runtime", async () => {
    const fetchedUrls: string[] = [];
    const result = await fetchOfficialPluginIndex({
      cachePath: join(dir, "plugins/cache.json"),
      env: {
        PIER_OFFICIAL_PLUGIN_INDEX_URL: "https://example.test/index.json",
      },
      runtimeMode: "production",
      verifySignature: () => true,
      fetchRawJson: async (url) => {
        fetchedUrls.push(url);
        return JSON.stringify({
          generatedAt: 1,
          plugins: {},
          sequence: 1,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        });
      },
    });
    expect(
      result.diagnostics.some((d) =>
        /ignored.*PIER_OFFICIAL_PLUGIN_INDEX_URL/.test(d.message)
      )
    ).toBe(true);
    expect(fetchedUrls).toEqual([
      "https://runloom.github.io/pier/plugins/index.v1.json",
    ]);
  });

  it("returns stale cache when a rollback update is rejected", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache.json");
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        highestSequence: 10,
        versionHashes: { "pier.codex@1.0.0": "old" },
        index: {
          generatedAt: 1,
          plugins: {},
          sequence: 10,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        },
      })
    );
    const result = await fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: () => true,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 2,
          plugins: {},
          sequence: 9,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        }),
    });

    expect(result.source).toBe("cache");
    expect(result.index?.sequence).toBe(10);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "official_index_rejected",
        severity: "warning",
      })
    );
    expect(result.diagnostics.at(-1)?.message).toContain(
      "official index rollback"
    );
  });

  it("returns stale cache when a same-version hash drift update is rejected", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache.json");
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        highestSequence: 10,
        versionHashes: { "pier.codex@1.0.0": "old" },
        index: {
          generatedAt: 1,
          plugins: {},
          sequence: 10,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        },
      })
    );
    const result = await fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: () => true,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 2,
          plugins: {
            "pier.codex": {
              description: "Codex",
              displayName: "Codex",
              id: "pier.codex",
              latest: "1.0.0",
              versions: {
                "1.0.0": {
                  assetUrl:
                    "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz",
                  pier: ">=0.1.0 <0.2.0",
                  sha256: "new",
                  size: 1,
                },
              },
            },
          },
          sequence: 11,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        }),
    });

    expect(result.source).toBe("cache");
    expect(result.index?.sequence).toBe(10);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "official_index_rejected",
        severity: "warning",
      })
    );
    expect(result.diagnostics.at(-1)?.message).toContain(
      "same-version hash drift"
    );
  });

  it("verifies signatures before schema parse and never signs stripped data", async () => {
    const signedPayloads: string[] = [];
    await fetchOfficialPluginIndex({
      cachePath: join(dir, "plugins/cache-order.json"),
      runtimeMode: "development",
      env: {},
      verifySignature: ({ payload }) => {
        signedPayloads.push(payload);
        return true;
      },
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 1,
          plugins: {},
          sequence: 1,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        }),
    });
    // canonical form: sorted keys, no whitespace, signature field removed
    expect(signedPayloads[0]).toBe(
      '{"generatedAt":1,"plugins":{},"sequence":1,"version":1}'
    );
    expect(signedPayloads[0]).not.toContain("signature");
  });

  it("returns empty diagnostics for unsigned indexes, unknown signing keys, and unsupported algorithms", async () => {
    const cachePath = join(dir, "plugins/cache-sig.json");
    const invalidSignature = await fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: () => false,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 1,
          plugins: {},
          sequence: 1,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "bad",
          },
          version: 1,
        }),
    });
    expect(invalidSignature.source).toBe("empty");
    expect(invalidSignature.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "official_index_rejected",
        severity: "error",
      })
    );
    expect(invalidSignature.diagnostics.at(-1)?.message).toContain(
      "official index signature"
    );

    const unsupportedAlgorithm = await fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: () => true,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 1,
          plugins: {},
          sequence: 1,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "RS256",
            value: "sig",
          },
          version: 1,
        }),
    });
    expect(unsupportedAlgorithm.source).toBe("empty");
    expect(unsupportedAlgorithm.diagnostics.at(-1)?.message).toContain(
      "unsupported signature algorithm"
    );

    const unknownKey = await fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: () => true,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 1,
          plugins: {},
          sequence: 1,
          signature: {
            keyId: "unknown-key",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        }),
    });
    expect(unknownKey.source).toBe("empty");
    expect(unknownKey.diagnostics.at(-1)?.message).toContain(
      "unknown signing key"
    );
  });

  it("returns empty diagnostics for non-allowlisted GitHub asset URLs and rejects non-HTTPS redirects", async () => {
    const cachePath = join(dir, "plugins/cache-asset.json");
    const result = await fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: () => true,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 1,
          plugins: {
            "pier.codex": {
              description: "Codex",
              displayName: "Codex",
              id: "pier.codex",
              latest: "1.0.0",
              versions: {
                "1.0.0": {
                  assetUrl:
                    "https://github.com/untrusted/codex/releases/download/v1.0.0/pkg.tgz",
                  pier: ">=0.1.0 <0.2.0",
                  sha256: "h",
                  size: 1,
                },
              },
            },
          },
          sequence: 1,
          signature: {
            keyId: "pier-official-dev-test",
            alg: "Ed25519",
            value: "sig",
          },
          version: 1,
        }),
    });
    expect(result.source).toBe("empty");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "official_index_rejected",
        severity: "error",
      })
    );
    expect(result.diagnostics.at(-1)?.message).toContain(
      "non-allowlisted GitHub asset"
    );
    await expect(
      validateOfficialAssetRedirect({
        assetUrl:
          "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz",
        finalUrl:
          "https://release-assets.githubusercontent.com/github-production-release-asset/1/pkg.tgz?sp=r",
      })
    ).resolves.toBeUndefined();
    await expect(
      validateOfficialAssetRedirect({
        assetUrl:
          "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz",
        finalUrl:
          "http://release-assets.githubusercontent.com/github-production-release-asset/1/pkg.tgz",
      })
    ).rejects.toThrow(/asset redirect/);
    await expect(
      validateOfficialAssetRedirect({
        assetUrl:
          "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz",
        finalUrl:
          "https://user:pass@release-assets.githubusercontent.com/github-production-release-asset/1/pkg.tgz",
      })
    ).rejects.toThrow(/asset redirect/);
    await expect(
      validateOfficialAssetRedirect({
        assetUrl:
          "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz",
        finalUrl: "https://evil.test/pkg.tgz",
      })
    ).rejects.toThrow(/asset redirect/);
  });

  it("rejects download when redirect count exceeds limit", async () => {
    let calls = 0;
    await expect(
      downloadOfficialPluginAsset({
        assetUrl:
          "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz",
        maxRedirects: 2,
        fetch: async () => {
          calls += 1;
          return {
            finalUrl:
              "https://release-assets.githubusercontent.com/redirect/pkg.tgz",
            body: Buffer.from(""),
            redirectCount: 3,
          };
        },
      })
    ).rejects.toThrow(/too many redirects/);
    expect(calls).toBe(1);
  });

  it("selects the highest compatible official version", () => {
    const selected = selectLatestCompatibleVersion(
      {
        description: "Codex",
        displayName: "Codex",
        id: "pier.codex",
        latest: "2.0.0",
        versions: {
          "1.0.0": {
            assetUrl: "https://github.com/a/b/releases/download/v1/pkg.tgz",
            pier: ">=0.1.0 <0.2.0",
            sha256: "1",
            size: 10,
          },
          "1.1.0": {
            assetUrl: "https://github.com/a/b/releases/download/v1.1/pkg.tgz",
            pier: ">=0.1.0 <0.2.0",
            sha256: "2",
            size: 10,
          },
          "2.0.0": {
            assetUrl: "https://github.com/a/b/releases/download/v2/pkg.tgz",
            pier: ">=0.2.0 <0.3.0",
            sha256: "3",
            size: 10,
          },
        },
      },
      "0.1.5"
    );
    expect(selected?.version).toBe("1.1.0");
  });
});
