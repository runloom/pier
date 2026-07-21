#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const indexFile = join(repoRoot, "plugins", "index.v1.json");
const releaseBase = "https://github.com/runloom/pier/releases/download";
const assetSource = parseAssetSource(process.argv.slice(2));

function parseAssetSource(args) {
  if (args.length === 0) {
    return "local";
  }
  if (args.length === 1 && args[0] === "--source=release") {
    return "release";
  }
  if (args.length === 1 && args[0] === "--source=local") {
    return "local";
  }
  fail(`unsupported arguments: ${args.join(" ")}`);
}

function releaseTail(id) {
  return id.replace(/^pier\./, "").replace(/\./g, "-");
}

function releaseTag(id, version) {
  return `plugin-${releaseTail(id)}-v${version}`;
}

function expectedAssetUrl(id, version) {
  return `${releaseBase}/${releaseTag(id, version)}/${id}-${version}.tgz`;
}

function localAssetPath(id, version) {
  return join(
    repoRoot,
    "packages",
    `plugin-${releaseTail(id)}`,
    "dist-pkg",
    `${id}-${version}.tgz`
  );
}

function fail(message) {
  throw new Error(`[verify-plugin-index] ${message}`);
}

function assertPluginId(id) {
  if (!/^pier\.[a-z0-9][a-z0-9.-]*$/.test(id)) {
    fail(`unsupported plugin id: ${id}`);
  }
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function assertAssetDigest(id, version, entry, actualSize, actualSha) {
  if (actualSize !== entry.size) {
    fail(
      `${id}@${version} size mismatch: expected ${entry.size}, got ${actualSize}`
    );
  }
  if (actualSha !== entry.sha256) {
    fail(
      `${id}@${version} sha256 mismatch: expected ${entry.sha256}, got ${actualSha}`
    );
  }
}

async function readIndex() {
  const raw = await readFile(indexFile, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(
      `index is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function assertSigned(index) {
  if (index?.signature?.alg !== "Ed25519") {
    fail("index signature must use Ed25519");
  }
  if (
    typeof index.signature.keyId !== "string" ||
    index.signature.keyId.length === 0 ||
    typeof index.signature.value !== "string" ||
    index.signature.value.length === 0
  ) {
    fail("index signature is incomplete");
  }
}

async function verifyLocalAsset(id, version, entry) {
  const assetPath = localAssetPath(id, version);
  const assetStat = await stat(assetPath).catch(() => null);
  if (!assetStat) {
    fail(`missing local package asset for ${id}@${version}: ${assetPath}`);
  }
  const actualSha = await sha256File(assetPath);
  assertAssetDigest(id, version, entry, assetStat.size, actualSha);
}

async function verifyReleaseAsset(id, version, entry) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { basename } = await import("node:path");
  const { spawnSync } = await import("node:child_process");

  const work = await mkdtemp(join(tmpdir(), "pier-verify-plugin-"));
  const tag = releaseTag(id, version);
  const pattern = basename(entry.assetUrl);
  try {
    const result = spawnSync(
      "gh",
      [
        "release",
        "download",
        tag,
        "--repo",
        "runloom/pier",
        "--pattern",
        pattern,
        "--dir",
        work,
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0) {
      fail(
        `could not download ${id}@${version} via gh: ${(result.stderr || result.stdout || "unknown error").trim()}`
      );
    }
    const assetPath = join(work, pattern);
    const assetStat = await stat(assetPath).catch(() => null);
    if (!assetStat) {
      fail(
        `could not download ${id}@${version}: missing ${pattern} after gh download`
      );
    }
    const actualSha = await sha256File(assetPath);
    assertAssetDigest(id, version, entry, assetStat.size, actualSha);
  } finally {
    await rm(work, { force: true, recursive: true });
  }
}

async function verifyIndex() {
  const index = await readIndex();
  assertSigned(index);

  const plugins = index.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    fail("index.plugins must be an object");
  }

  for (const [id, plugin] of Object.entries(plugins)) {
    assertPluginId(id);
    const versions = plugin?.versions;
    if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
      fail(`${id} versions must be an object`);
    }

    for (const [version, entry] of Object.entries(versions)) {
      const expectedUrl = expectedAssetUrl(id, version);
      if (entry.assetUrl !== expectedUrl) {
        fail(
          `${id}@${version} assetUrl mismatch: expected ${expectedUrl}, got ${entry.assetUrl}`
        );
      }
      if (
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      ) {
        fail(`${id}@${version} sha256 must be a lowercase hex digest`);
      }
      if (!Number.isInteger(entry.size) || entry.size <= 0) {
        fail(`${id}@${version} size must be a positive integer`);
      }

      if (assetSource === "release") {
        await verifyReleaseAsset(id, version, entry);
      } else {
        await verifyLocalAsset(id, version, entry);
      }
      console.log(`verified ${id}@${version} from ${assetSource}`);
    }
  }
}

await verifyIndex();
console.log("plugin index asset verification passed");
