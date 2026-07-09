import { execFile } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalizeIndexPayload } from "@main/services/managed-plugins/official-index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = resolve("scripts/generate-plugin-index.mjs");
const SIGNING_FIXTURE_PATH = resolve(
  "tests/fixtures/plugin-official-index/dev-test-signing-key.json"
);

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-plugin-index-generation-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("generate-plugin-index", () => {
  it("signs the generated official index with Ed25519 when signing env is present", async () => {
    const fixture = JSON.parse(
      await readFile(SIGNING_FIXTURE_PATH, "utf8")
    ) as {
      keyId: string;
      privateKeyPkcs8Base64: string;
      publicKeySpkiBase64: string;
    };
    const pluginDir = join(dir, "packages", "plugin-codex");
    const distPkg = join(pluginDir, "dist-pkg");
    const archivePath = join(distPkg, "pier.codex-1.2.3.tgz");
    await mkdir(distPkg, { recursive: true });
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        apiVersion: 1,
        commands: [],
        missionControlWidgets: [],
        description: "Codex account management.",
        engines: { pier: ">=0.1.0 <0.2.0" },
        id: "pier.codex",
        main: "dist/main.js",
        name: "Codex",
        panels: [],
        permissions: [],
        renderer: "dist/renderer.js",
        terminalStatusItems: [],
        version: "1.2.3",
      }),
      "utf8"
    );
    await writeFile(archivePath, "archive bytes", "utf8");
    await writeFile(`${archivePath}.sha256`, `${"a".repeat(64)}\n`, "utf8");
    const archiveStat = await stat(archivePath);

    await execFileAsync(process.execPath, [SCRIPT_PATH], {
      cwd: dir,
      env: {
        ...process.env,
        PIER_INDEX_GENERATED_AT: "10",
        PIER_INDEX_SEQUENCE: "4",
        PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE: "1",
        PIER_PLUGIN_INDEX_SIGNING_KEY_ID: fixture.keyId,
        PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64:
          fixture.privateKeyPkcs8Base64,
      },
    });

    const index = JSON.parse(
      await readFile(join(dir, "plugins", "index.v1.json"), "utf8")
    ) as {
      signature: { alg: string; keyId: string; value: string };
      plugins: {
        "pier.codex": {
          versions: { "1.2.3": { size: number } };
        };
      };
    };
    const publicKey = createPublicKey({
      key: Buffer.from(fixture.publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });

    expect(index.signature).toMatchObject({
      alg: "Ed25519",
      keyId: fixture.keyId,
    });
    expect(index.plugins["pier.codex"].versions["1.2.3"].size).toBe(
      archiveStat.size
    );
    expect(
      verify(
        null,
        Buffer.from(canonicalizeIndexPayload(index), "utf8"),
        publicKey,
        Buffer.from(index.signature.value, "base64")
      )
    ).toBe(true);
  });
});
