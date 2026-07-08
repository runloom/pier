import { mkdtemp, rm } from "node:fs/promises";
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
});
