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

async function writeCodexPackage(options: {
  readonly sha256: string;
  readonly version: string;
}): Promise<string> {
  const pluginDir = join(dir, "packages", "plugin-codex");
  const distPkg = join(pluginDir, "dist-pkg");
  const archivePath = join(distPkg, `pier.codex-${options.version}.tgz`);
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
      version: options.version,
    }),
    "utf8"
  );
  await writeFile(archivePath, "archive bytes", "utf8");
  await writeFile(`${archivePath}.sha256`, `${options.sha256}\n`, "utf8");
  return archivePath;
}

async function writeExistingIndex(options: {
  readonly sequence: number;
  readonly sha256: string;
  readonly version: string;
}): Promise<void> {
  await mkdir(join(dir, "plugins"), { recursive: true });
  await writeFile(
    join(dir, "plugins", "index.v1.json"),
    JSON.stringify({
      generatedAt: 1,
      plugins: {
        "pier.codex": {
          description: "Codex account management.",
          displayName: "Codex",
          id: "pier.codex",
          latest: options.version,
          versions: {
            [options.version]: {
              assetUrl: `https://github.com/runloom/pier/releases/download/plugin-codex-v${options.version}/pier.codex-${options.version}.tgz`,
              pier: ">=0.1.0 <0.2.0",
              sha256: options.sha256,
              size: 13,
            },
          },
        },
      },
      sequence: options.sequence,
      signature: { alg: "Ed25519", keyId: "test", value: "test" },
      version: 1,
    }),
    "utf8"
  );
}

function commandOutput(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return String(err);
  }
  const output: string[] = [];
  if ("stdout" in err) {
    output.push(String((err as { stdout?: unknown }).stdout ?? ""));
  }
  if ("stderr" in err) {
    output.push(String((err as { stderr?: unknown }).stderr ?? ""));
  }
  return output.join("\n");
}

describe("generate-plugin-index", () => {
  it("signs the generated official index with Ed25519 when signing env is present", async () => {
    const fixture = JSON.parse(
      await readFile(SIGNING_FIXTURE_PATH, "utf8")
    ) as {
      keyId: string;
      privateKeyPkcs8Base64: string;
      publicKeySpkiBase64: string;
    };
    const archivePath = await writeCodexPackage({
      sha256: "a".repeat(64),
      version: "1.2.3",
    });
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

  it("defaults the generated sequence to the previous sequence plus one", async () => {
    await writeCodexPackage({
      sha256: "a".repeat(64),
      version: "1.2.3",
    });
    await writeExistingIndex({
      sequence: 7,
      sha256: "a".repeat(64),
      version: "1.2.3",
    });

    await execFileAsync(process.execPath, [SCRIPT_PATH], {
      cwd: dir,
      env: {
        ...process.env,
        PIER_INDEX_GENERATED_AT: "10",
      },
    });

    const index = JSON.parse(
      await readFile(join(dir, "plugins", "index.v1.json"), "utf8")
    ) as { sequence: number };
    expect(index.sequence).toBe(8);
  });

  it("rejects same-version package hash drift from the existing index", async () => {
    await writeCodexPackage({
      sha256: "a".repeat(64),
      version: "1.2.3",
    });
    await writeExistingIndex({
      sequence: 7,
      sha256: "b".repeat(64),
      version: "1.2.3",
    });

    let thrown: unknown;
    try {
      await execFileAsync(process.execPath, [SCRIPT_PATH], {
        cwd: dir,
        env: {
          ...process.env,
          PIER_INDEX_GENERATED_AT: "10",
        },
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(commandOutput(thrown)).toContain(
      "same-version hash drift for pier.codex@1.2.3"
    );
  });
});
