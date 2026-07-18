/**
 * Hard gate: local dist-builder (or an asset name list) must contain the full
 * dual-arch mac host release set before publish / release acceptance.
 *
 * Usage:
 *   node scripts/verify-mac-release-artifacts.mjs --dir dist-builder --version 0.1.1
 *   node scripts/verify-mac-release-artifacts.mjs --version 0.1.1 --assets a,b,c
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeReleaseVersion,
  recommendedMacReleaseBlockmapNames,
  requiredMacReleaseAssetNames,
  validateLatestMacYmlFiles,
  validateMacReleaseAssetNames,
} from "./mac-release-assets.mjs";

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ dir?: string, version?: string, assets?: string[], help?: boolean }} */
  const out = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--dir") {
      i += 1;
      out.dir = args[i];
    } else if (a === "--version") {
      i += 1;
      out.version = args[i];
    } else if (a === "--assets") {
      i += 1;
      out.assets = String(args[i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
    i += 1;
  }
  return out;
}

/**
 * @param {{ assetNames: string[], version: string, latestMacYmlText?: string }} input
 * @returns {string[]}
 */
export function validateMacReleaseArtifacts(input) {
  const version = normalizeReleaseVersion(input.version);
  const errors = [...validateMacReleaseAssetNames(input.assetNames, version)];
  if (input.latestMacYmlText != null) {
    errors.push(...validateLatestMacYmlFiles(input.latestMacYmlText, version));
  }
  return errors;
}

/**
 * @param {string} dir
 * @param {string} version
 */
export async function validateMacReleaseDir(dir, version) {
  const v = normalizeReleaseVersion(version);
  const abs = resolve(dir);
  const entries = await readdir(abs);
  const latestPath = join(abs, "latest-mac.yml");
  let latestMacYmlText;
  if (entries.includes("latest-mac.yml")) {
    latestMacYmlText = await readFile(latestPath, "utf8");
  }
  const errors = validateMacReleaseArtifacts({
    assetNames: entries,
    version: v,
    latestMacYmlText,
  });
  return {
    errors,
    required: requiredMacReleaseAssetNames(v),
    recommendedBlockmaps: recommendedMacReleaseBlockmapNames(v),
    present: entries,
  };
}

/**
 * @param {string[]} [argv]
 */
async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(
      "Usage: verify-mac-release-artifacts.mjs --version X.Y.Z (--dir dist-builder | --assets a,b,c)"
    );
    process.exit(0);
  }
  if (!opts.version) {
    console.error("[verify-mac-release-artifacts] --version is required");
    process.exit(2);
  }
  if (!(opts.dir || opts.assets)) {
    console.error("[verify-mac-release-artifacts] provide --dir or --assets");
    process.exit(2);
  }

  /** @type {string[]} */
  let errors;
  if (opts.dir) {
    const result = await validateMacReleaseDir(opts.dir, opts.version);
    errors = result.errors;
    if (errors.length === 0) {
      const missingBlockmaps = result.recommendedBlockmaps.filter(
        (name) => !result.present.includes(name)
      );
      if (missingBlockmaps.length > 0) {
        console.warn(
          `[verify-mac-release-artifacts] warning: missing blockmaps (diff updates degraded): ${missingBlockmaps.join(", ")}`
        );
      }
    }
  } else {
    errors = validateMacReleaseArtifacts({
      assetNames: opts.assets ?? [],
      version: opts.version,
    });
  }

  if (errors.length > 0) {
    console.error("[verify-mac-release-artifacts] FAILED:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  const required = requiredMacReleaseAssetNames(opts.version).join(", ");
  console.log(
    `[verify-mac-release-artifacts] ok: dual-arch mac assets present (${required})`
  );
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(
      "[verify-mac-release-artifacts]",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
