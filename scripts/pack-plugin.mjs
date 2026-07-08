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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { crc32 } from "node:zlib";
import tar from "tar-stream";

const pluginDir = resolve(process.cwd());
const manifestPath = join(pluginDir, "plugin.json");
const packageJsonPath = join(pluginDir, "package.json");
const MAX_STORED_DEFLATE_BLOCK_SIZE = 0xff_ff;
const GZIP_ISIZE_MODULO = 2 ** 32;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function deflateStored(buffer) {
  if (buffer.length === 0) {
    return Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]);
  }

  const chunks = [];
  for (
    let offset = 0;
    offset < buffer.length;
    offset += MAX_STORED_DEFLATE_BLOCK_SIZE
  ) {
    const block = buffer.subarray(
      offset,
      Math.min(offset + MAX_STORED_DEFLATE_BLOCK_SIZE, buffer.length)
    );
    const header = Buffer.alloc(5);
    header[0] = offset + block.length >= buffer.length ? 0x01 : 0x00;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(0xff_ff - block.length, 3);
    chunks.push(header, block);
  }
  return Buffer.concat(chunks);
}

function deterministicGzip(buffer) {
  const header = Buffer.from([
    0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
  ]);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(buffer), 0);
  trailer.writeUInt32LE(buffer.length % GZIP_ISIZE_MODULO, 4);
  return Buffer.concat([header, deflateStored(buffer), trailer]);
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
const tarChunks = [];
const streamDone = new Promise((resolveStream, rejectStream) => {
  pack.on("data", (chunk) => tarChunks.push(Buffer.from(chunk)));
  pack.on("end", resolveStream);
  pack.on("error", rejectStream);
});

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

const archiveBytes = deterministicGzip(Buffer.concat(tarChunks));
await writeFile(archivePath, archiveBytes);
const digest = createHash("sha256").update(archiveBytes).digest("hex");
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
