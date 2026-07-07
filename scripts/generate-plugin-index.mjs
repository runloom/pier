#!/usr/bin/env node
// Builds `plugins/index.v1.json` from every `@pier/plugin-*` package's
// `dist-pkg/<id>-<version>.tgz` + `.sha256`.
//
// Usage:
//   pnpm plugins:pack           # build + pack every plugin
//   pnpm plugins:index          # regenerate this index
//
// The generated file follows `officialPluginIndexSchema` (v1). The signature
// is a stub — Ed25519 signing runs in CI (`.github/workflows/release-plugin.yml`)
// with a repo secret. Locally-produced indices carry the reserved
// `alg: "unsigned"` marker so runtime verification refuses them.

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
  return {
    manifest,
    entry: {
      description: manifest.description,
      displayName: manifest.name,
      id: manifest.id,
      latest: manifest.version,
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

const dirents = await readdir(packagesDir, { withFileTypes: true });
const plugins = {};
for (const d of dirents) {
  if (!(d.isDirectory() && d.name.startsWith("plugin-"))) continue;
  const info = await collectPlugin(join(packagesDir, d.name));
  if (info) plugins[info.entry.id] = info.entry;
}

const generatedAt = Number(process.env.PIER_INDEX_GENERATED_AT ?? Date.now());
const sequence = Number(process.env.PIER_INDEX_SEQUENCE ?? 1);

const index = {
  generatedAt,
  plugins,
  sequence,
  signature: {
    // Placeholder for local runs; CI replaces this with a real Ed25519 sig.
    alg: "unsigned",
    keyId: "pier-official-dev-test",
    value: "0".repeat(88),
  },
  version: 1,
};

await writeFile(outFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    { file: outFile, generatedAt, plugins: Object.keys(plugins), sequence },
    null,
    2
  )
);
