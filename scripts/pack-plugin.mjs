#!/usr/bin/env node
// Pack a managed plugin package directory into `<id>-<version>.tgz` + `.sha256`.
// Called by each `@pier/plugin-*` package's `pack` script.
//
// Layout produced under `<pluginDir>/dist-pkg/`:
//   pier.codex-1.0.0.tgz         # gzipped tar with plugin.json, package.json, dist/
//   pier.codex-1.0.0.tgz.sha256  # single-line hex sha256
//
// The tgz is fed to `extractTgzSafely` at install time; content shape must
// match `validateManagedPluginPackage` expectations.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import tar from "tar-stream";

const pluginDir = resolve(process.cwd());
const manifestPath = join(pluginDir, "plugin.json");
const packageJsonPath = join(pluginDir, "package.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const manifest = await readJson(manifestPath);
const packageJson = await readJson(packageJsonPath);

if (!manifest.id) {
  throw new Error(`missing "id" in ${manifestPath}`);
}
if (!manifest.version) {
  throw new Error(`missing "version" in ${manifestPath}`);
}
if (manifest.version !== packageJson.version) {
  throw new Error(
    `plugin.json version (${manifest.version}) mismatch package.json version (${packageJson.version})`
  );
}

const outDir = join(pluginDir, "dist-pkg");
await rm(outDir, { force: true, recursive: true });
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "plugin.json"), await readFile(manifestPath));

const archiveName = `${manifest.id}-${manifest.version}.tgz`;
const archivePath = join(outDir, archiveName);

const members = [
  { name: "plugin.json", path: manifestPath },
  { name: "package.json", path: packageJsonPath },
  { name: "dist/main.js", path: join(pluginDir, manifest.main) },
  { name: "dist/renderer.js", path: join(pluginDir, manifest.renderer) },
];

const pack = tar.pack();
const gzip = createGzip();
const out = createWriteStream(archivePath);
const streamDone = pipeline(pack, gzip, out);

for (const member of members) {
  const data = await readFile(member.path);
  await new Promise((resolveEntry, rejectEntry) => {
    pack.entry(
      { name: member.name, size: data.length, mode: 0o644, mtime: new Date(0) },
      data,
      (err) => (err ? rejectEntry(err) : resolveEntry())
    );
  });
}
pack.finalize();
await streamDone;

const hash = createHash("sha256");
await pipeline(createReadStream(archivePath), hash);
const digest = hash.digest("hex");
await writeFile(`${archivePath}.sha256`, `${digest}\n`, "utf8");

const { size } = await import("node:fs").then((m) =>
  m.promises.stat(archivePath)
);

const summary = {
  archive: archiveName,
  id: manifest.id,
  path: archivePath,
  sha256: digest,
  size,
  version: manifest.version,
};
console.log(JSON.stringify(summary, null, 2));
