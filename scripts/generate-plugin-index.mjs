#!/usr/bin/env node
// Builds `plugins/index.v1.json` from every `@pier/plugin-*` package's
// `dist-pkg/<id>-<version>.tgz` + `.sha256`.
//
// Usage:
//   pnpm plugins:pack           # build + pack every plugin
//   pnpm plugins:index          # regenerate this index
//
// The generated file follows `officialPluginIndexSchema` (v1). When
// PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64 is present, this script signs the
// canonical payload with Ed25519 before writing. Release CI sets
// PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE=1 so unsigned output cannot be committed.

import { createPrivateKey, sign } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const packagesDir = join(repoRoot, "packages");
const outFile = join(repoRoot, "plugins", "index.v1.json");

// GitHub release asset URL scheme:
//   https://github.com/runloom/pier/releases/download/plugin-<id-tail>-v<version>/<id>-<version>.tgz
// The `<id-tail>` is the plugin id with the `pier.` prefix stripped and dots
// replaced by dashes, e.g. `pier.codex` → `codex`.
const RELEASE_BASE = "https://github.com/runloom/pier/releases/download";

function releaseTag(id, version) {
  const tail = id.replace(/^pier\./, "").replace(/\./g, "-");
  return `plugin-${tail}-v${version}`;
}

function assetUrl(id, version) {
  return `${RELEASE_BASE}/${releaseTag(id, version)}/${id}-${version}.tgz`;
}

function stripRootSignature(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const clone = {};
  for (const [key, val] of Object.entries(value)) {
    if (key !== "signature") {
      clone[key] = val;
    }
  }
  return clone;
}

function canonicalize(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported value in canonicalize: ${typeof value}`);
}

function compareKeys(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function canonicalizeIndexPayload(value) {
  return canonicalize(stripRootSignature(value));
}

function unsignedSignature() {
  return {
    alg: "unsigned",
    keyId:
      process.env.PIER_PLUGIN_INDEX_SIGNING_KEY_ID ?? "pier-official-dev-test",
    value: "0".repeat(88),
  };
}

function signIndex(indexWithoutSignature) {
  const privateKeyBase64 =
    process.env.PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64;
  const privateKeyPem = process.env.PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_PEM;
  const requireSignature =
    process.env.PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE === "1";
  const keyId =
    process.env.PIER_PLUGIN_INDEX_SIGNING_KEY_ID ?? "pier-official-dev-test";

  if (!(privateKeyBase64 || privateKeyPem)) {
    if (requireSignature) {
      throw new Error(
        "PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE=1 but no Ed25519 signing key was provided"
      );
    }
    return unsignedSignature();
  }

  const privateKey = privateKeyBase64
    ? createPrivateKey({
        key: Buffer.from(privateKeyBase64, "base64"),
        format: "der",
        type: "pkcs8",
      })
    : createPrivateKey(privateKeyPem);
  const payload = canonicalizeIndexPayload(indexWithoutSignature);
  return {
    alg: "Ed25519",
    keyId,
    value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
      "base64"
    ),
  };
}

async function readManifest(pluginDir) {
  const raw = await readFile(join(pluginDir, "plugin.json"), "utf8").catch(
    () => null
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function collectPlugin(pluginDir) {
  const manifest = await readManifest(pluginDir);
  if (!(manifest?.id && manifest?.version)) return null;
  const distPkg = join(pluginDir, "dist-pkg");
  const tgz = join(distPkg, `${manifest.id}-${manifest.version}.tgz`);
  const shaFile = `${tgz}.sha256`;
  const tgzStat = await stat(tgz).catch(() => null);
  const shaRaw = await readFile(shaFile, "utf8").catch(() => null);
  if (!(tgzStat && shaRaw)) {
    console.warn(
      `[index] skipping ${manifest.id}: run \`pnpm plugin:${manifest.id.replace(/^pier\./, "")}:pack\` first`
    );
    return null;
  }
  const sha256 = shaRaw.trim().split(/\s+/)[0];
  const localesSubset = manifest.locales
    ? Object.fromEntries(
        Object.entries(manifest.locales)
          .map(([code, msgs]) => {
            const pair = {};
            if (msgs.name) pair.name = msgs.name;
            if (msgs.description) pair.description = msgs.description;
            return [code, pair];
          })
          .filter(([, v]) => v.name || v.description)
      )
    : undefined;
  return {
    manifest,
    entry: {
      description: manifest.description,
      displayName: manifest.name,
      id: manifest.id,
      latest: manifest.version,
      ...(localesSubset && Object.keys(localesSubset).length > 0
        ? { locales: localesSubset }
        : {}),
      versions: {
        [manifest.version]: {
          assetUrl: assetUrl(manifest.id, manifest.version),
          pier: manifest.engines?.pier ?? ">=0.1.0",
          sha256,
          size: tgzStat.size,
        },
      },
    },
  };
}

async function readExistingIndex() {
  const raw = await readFile(outFile, "utf8").catch((err) => {
    if (err?.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `existing official plugin index is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function previousSequence(existingIndex) {
  return Number.isInteger(existingIndex?.sequence) ? existingIndex.sequence : 0;
}

function nextSequence(existingIndex) {
  const explicit = process.env.PIER_INDEX_SEQUENCE;
  const sequence =
    explicit === undefined
      ? previousSequence(existingIndex) + 1
      : Number(explicit);
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(`invalid PIER_INDEX_SEQUENCE: ${explicit ?? sequence}`);
  }
  return sequence;
}

/**
 * Prefer already-indexed digests for a version that was published before.
 * Local `plugins:pack` rebuilds are not bit-stable across machines / deps, so
 * reusing the committed index entry keeps clients pointed at the immutable
 * GitHub release asset. New versions still come from the local pack.
 */
function mergePluginVersions(previousVersions, packedVersions, pluginId) {
  const merged = { ...(previousVersions ?? {}) };
  for (const [version, entry] of Object.entries(packedVersions ?? {})) {
    const previousEntry = previousVersions?.[version];
    if (previousEntry?.sha256) {
      const sizeDrift =
        Number.isInteger(previousEntry.size) &&
        previousEntry.size !== entry.size;
      if (previousEntry.sha256 !== entry.sha256 || sizeDrift) {
        console.warn(
          `reusing published digest for ${pluginId}@${version} (local rebuild drifted; bump the plugin version to publish a new asset)`
        );
      }
      merged[version] = previousEntry;
      continue;
    }
    merged[version] = entry;
  }
  return merged;
}

const dirents = await readdir(packagesDir, { withFileTypes: true });
const packedPlugins = {};
for (const d of dirents) {
  if (!(d.isDirectory() && d.name.startsWith("plugin-"))) continue;
  const info = await collectPlugin(join(packagesDir, d.name));
  if (info) packedPlugins[info.entry.id] = info.entry;
}

const existingIndex = await readExistingIndex();

// Merge: keep previously indexed plugins that were not re-packed in this run
// (partial packs / single-plugin recovery must not erase the catalog). Same
// version digests stay immutable even when a local rebuild drifts.
const plugins = { ...packedPlugins };
const previousPlugins = existingIndex?.plugins;
if (
  previousPlugins &&
  typeof previousPlugins === "object" &&
  !Array.isArray(previousPlugins)
) {
  for (const [id, previous] of Object.entries(previousPlugins)) {
    const packed = packedPlugins[id];
    if (!packed) {
      plugins[id] = previous;
      continue;
    }
    plugins[id] = {
      ...previous,
      ...packed,
      versions: mergePluginVersions(previous.versions, packed.versions, id),
      latest: packed.latest,
    };
  }
}

const generatedAt = Number(process.env.PIER_INDEX_GENERATED_AT ?? Date.now());
const sequence = nextSequence(existingIndex);

const indexPayload = {
  generatedAt,
  plugins,
  sequence,
  version: 1,
};
const signature = signIndex(indexPayload);
const index = { ...indexPayload, signature };

await writeFile(outFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      file: outFile,
      generatedAt,
      plugins: Object.keys(plugins),
      sequence,
      signature: { alg: signature.alg, keyId: signature.keyId },
    },
    null,
    2
  )
);
