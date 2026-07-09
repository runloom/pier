import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpOfficialIndexProvider } from "@main/services/managed-plugins/http-index-provider.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-http-index-provider-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("createHttpOfficialIndexProvider", () => {
  it("refreshes the official index through a network fetcher", async () => {
    const fetchRawJson = vi.fn(async () =>
      JSON.stringify({
        generatedAt: 10,
        plugins: {},
        sequence: 7,
        signature: {
          alg: "Ed25519",
          keyId: "pier-official-dev-test",
          value: "sig",
        },
        version: 1,
      })
    );
    const provider = createHttpOfficialIndexProvider({
      cachePath: join(dir, "official-index-cache.json"),
      fetchRawJson,
      now: () => 10,
      runtimeMode: "test",
      verifySignature: () => true,
    });

    const result = await provider.refresh();

    expect(fetchRawJson).toHaveBeenCalledWith(
      "https://runloom.github.io/pier/plugins/index.v1.json"
    );
    expect(result.source).toBe("network");
    expect(result.index?.sequence).toBe(7);
    expect(provider.snapshot()?.sequence).toBe(7);
  });

  it("uses the configured index URL without relying on the env override", async () => {
    const fetchedUrls: string[] = [];
    const provider = createHttpOfficialIndexProvider({
      cachePath: join(dir, "official-index-cache.json"),
      env: {
        PIER_OFFICIAL_PLUGIN_INDEX_URL: "https://env.example/index.json",
      },
      fetchRawJson: async (url) => {
        fetchedUrls.push(url);
        return JSON.stringify({
          generatedAt: 10,
          plugins: {},
          sequence: 8,
          signature: {
            alg: "Ed25519",
            keyId: "pier-official-dev-test",
            value: "sig",
          },
          version: 1,
        });
      },
      indexUrl: "https://configured.example/index.json",
      now: () => 10,
      runtimeMode: "production",
      verifySignature: () => true,
    });

    const result = await provider.refresh();

    expect(result.source).toBe("network");
    expect(fetchedUrls).toEqual(["https://configured.example/index.json"]);
    expect(result.diagnostics.map((d) => d.code)).not.toContain(
      "env_override_ignored"
    );
  });

  it("allows user-triggered refreshes to bypass the cache interval", async () => {
    let now = 10;
    const fetchRawJson = vi.fn(async () =>
      JSON.stringify({
        generatedAt: now,
        plugins: {},
        sequence: fetchRawJson.mock.calls.length,
        signature: {
          alg: "Ed25519",
          keyId: "pier-official-dev-test",
          value: "sig",
        },
        version: 1,
      })
    );
    const provider = createHttpOfficialIndexProvider({
      cachePath: join(dir, "official-index-cache.json"),
      fetchRawJson,
      now: () => now,
      runtimeMode: "test",
      verifySignature: () => true,
    });

    const first = await provider.refresh();
    now = 20;
    const cached = await provider.refresh();
    const forced = await provider.refresh({ force: true });

    expect(first.source).toBe("network");
    expect(cached.source).toBe("cache");
    expect(forced.source).toBe("network");
    expect(fetchRawJson).toHaveBeenCalledTimes(2);
    expect(forced.index?.sequence).toBe(2);
  });

  it("resolves with cached index diagnostics when a remote update is rejected", async () => {
    const cachePath = join(dir, "official-index-cache.json");
    await mkdir(dir, { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        fetchedAt: 1,
        highestSequence: 10,
        index: {
          generatedAt: 1,
          plugins: {},
          sequence: 10,
          signature: {
            alg: "Ed25519",
            keyId: "pier-official-dev-test",
            value: "sig",
          },
          version: 1,
        },
        versionHashes: { "pier.codex@1.0.0": "old" },
      }),
      "utf8"
    );
    const provider = createHttpOfficialIndexProvider({
      cachePath,
      fetchRawJson: async () =>
        JSON.stringify({
          generatedAt: 2,
          plugins: {
            "pier.codex": {
              displayName: "Codex",
              id: "pier.codex",
              latest: "1.0.0",
              versions: {
                "1.0.0": {
                  assetUrl:
                    "https://github.com/runloom/pier/releases/download/plugin-codex-v1.0.0/pier.codex-1.0.0.tgz",
                  pier: ">=0.1.0 <0.2.0",
                  sha256: "new",
                  size: 1,
                },
              },
            },
          },
          sequence: 11,
          signature: {
            alg: "Ed25519",
            keyId: "pier-official-dev-test",
            value: "sig",
          },
          version: 1,
        }),
      now: () => 100_000,
      runtimeMode: "test",
      verifySignature: () => true,
    });

    const result = await provider.refresh();
    await provider.whenReady();

    expect(result.source).toBe("cache");
    expect(result.index?.sequence).toBe(10);
    expect(provider.snapshot()?.sequence).toBe(10);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "official_index_rejected",
        severity: "warning",
      })
    );
  });
});
