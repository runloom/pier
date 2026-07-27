#!/usr/bin/env node
/**
 * Fetch packaged ripgrep binaries into resources/search/<arch>/rg.
 *
 * macOS: downloads official BurntSushi/ripgrep releases for arm64 + x64.
 * Dev fallback: host `which rg` only for the host arch (never into the other arch).
 *
 * Usage:
 *   node scripts/fetch-file-search-runtime.mjs
 *   REQUIRE_DUAL_ARCH=1 node scripts/fetch-file-search-runtime.mjs   # fail if either arch missing
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "resources", "search");
const require = createRequire(import.meta.url);
const REQUIRE_DUAL = process.env.REQUIRE_DUAL_ARCH === "1";

/** Pin a known-good ripgrep release for reproducible packaging. */
const RG_VERSION = "14.1.1";

const MAC_ASSETS = {
  arm64: {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-apple-darwin.tar.gz`,
    member: `ripgrep-${RG_VERSION}-aarch64-apple-darwin/rg`,
  },
  x64: {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-apple-darwin.tar.gz`,
    member: `ripgrep-${RG_VERSION}-x86_64-apple-darwin/rg`,
  },
};

function mapArch(a) {
  if (a === "arm64" || a === "aarch64") return "arm64";
  return "x64";
}

function writeBinary(arch, fromPath) {
  const dir = join(outRoot, arch);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "rg");
  if (existsSync(dest)) {
    try {
      chmodSync(dest, 0o755);
      unlinkSync(dest);
    } catch {
      // best-effort
    }
  }
  copyFileSync(fromPath, dest);
  chmodSync(dest, 0o755);
  console.log(`[fetch-file-search-runtime] wrote ${dest}`);
  return dest;
}

function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

async function downloadTo(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} ${url}`);
  }
  await pipeline(res.body, createWriteStream(destPath));
}

async function fetchMacArch(arch) {
  const asset = MAC_ASSETS[arch];
  if (!asset) return false;
  const work = join(tmpdir(), `pier-rg-${arch}-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const tgz = join(work, "rg.tgz");
  try {
    console.log(`[fetch-file-search-runtime] downloading ${arch}: ${asset.url}`);
    await downloadTo(asset.url, tgz);
    // Extract only the rg binary path via tar CLI (portable).
    const extract = spawnSync(
      "tar",
      ["-xzf", tgz, "-C", work, asset.member],
      { encoding: "utf8" }
    );
    if (extract.status !== 0) {
      console.error(extract.stderr || extract.stdout);
      return false;
    }
    const bin = join(work, asset.member);
    if (!existsSync(bin)) {
      console.error(`[fetch-file-search-runtime] missing member ${asset.member}`);
      return false;
    }
    writeBinary(arch, bin);
    return true;
  } catch (error) {
    console.error(
      `[fetch-file-search-runtime] ${arch} download failed:`,
      error instanceof Error ? error.message : error
    );
    return false;
  } finally {
    try {
      rmSync(work, { force: true, recursive: true });
    } catch {
      // ignore
    }
  }
}

function tryVscodeRipgrepHostOnly() {
  try {
    const pkgPath = require.resolve("@vscode/ripgrep/package.json");
    const bin = join(dirname(pkgPath), "bin", "rg");
    if (existsSync(bin)) {
      writeBinary(mapArch(osArch()), bin);
      return true;
    }
  } catch {
    // optional
  }
  return false;
}

function tryWhichRgHostOnly() {
  const which = spawnSync("which", ["rg"], { encoding: "utf8" });
  if (which.status !== 0) return false;
  const path = which.stdout.trim();
  if (!path || !existsSync(path)) return false;
  writeBinary(mapArch(osArch()), path);
  return true;
}

function writeManifest(binaries) {
  const entries = {};
  for (const arch of binaries) {
    const path = join(outRoot, arch, "rg");
    if (existsSync(path)) {
      entries[arch] = {
        path: `search/${arch}/rg`,
        sha256: sha256File(path),
        size: readFileSync(path).byteLength,
      };
    }
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: platform(),
    hostArch: mapArch(osArch()),
    rgVersion: RG_VERSION,
    binaries: entries,
  };
  const file = join(outRoot, "manifest.json");
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[fetch-file-search-runtime] wrote ${file}`);
}

function verifyArch(arch) {
  const path = join(outRoot, arch, "rg");
  if (!existsSync(path)) return false;
  const bytes = readFileSync(path);
  return bytes.byteLength >= 1000;
}

mkdirSync(outRoot, { recursive: true });
const written = new Set();

async function main() {
  if (platform() === "darwin") {
    for (const arch of ["arm64", "x64"]) {
      if (await fetchMacArch(arch)) {
        written.add(arch);
      }
    }
  }

  // Host-only fallbacks if download failed for this machine.
  const host = mapArch(osArch());
  if (!written.has(host)) {
    if (tryVscodeRipgrepHostOnly() || tryWhichRgHostOnly()) {
      written.add(host);
    }
  }

  if (written.size === 0) {
    console.error(
      "[fetch-file-search-runtime] no rg binary obtained. Install network access or host rg."
    );
    process.exit(1);
  }

  writeManifest([...written]);

  for (const arch of written) {
    if (!verifyArch(arch)) {
      console.error(`[fetch-file-search-runtime] invalid binary for ${arch}`);
      process.exit(1);
    }
  }

  if (REQUIRE_DUAL && platform() === "darwin") {
    for (const arch of ["arm64", "x64"]) {
      if (!verifyArch(arch)) {
        console.error(
          `[fetch-file-search-runtime] REQUIRE_DUAL_ARCH: missing ${arch}`
        );
        process.exit(1);
      }
    }
  }

  console.log(
    `[fetch-file-search-runtime] ok (arches: ${[...written].join(", ")})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
