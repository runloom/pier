/**
 * Publish verified dual-arch mac artifacts via electron-builder.
 *
 * Why this wrapper exists:
 * `electron-builder publish` catches upload errors, logs them, and returns
 * null without always failing the process. That can leave a partial GitHub
 * Latest release green. We verify local assets first, publish explicitly, and
 * hard-fail when the publisher returns null / throws.
 *
 * Usage:
 *   node scripts/publish-mac-release-artifacts.mjs --dir dist-builder --version 0.1.1 --policy always
 */
import { access } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  normalizeReleaseVersion,
  recommendedMacReleaseBlockmapNames,
  requiredMacReleaseAssetNames,
} from "./mac-release-assets.mjs";
import { validateMacReleaseDir } from "./verify-mac-release-artifacts.mjs";

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ dir?: string, version?: string, policy?: string, help?: boolean }} */
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
    } else if (a === "--policy") {
      i += 1;
      out.policy = args[i];
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
    i += 1;
  }
  return out;
}

/**
 * @param {string} dir
 * @param {string} version
 * @returns {Promise<string[]>}
 */
export async function collectPublishFiles(dir, version) {
  const v = normalizeReleaseVersion(version);
  const abs = resolve(dir);
  const required = requiredMacReleaseAssetNames(v).map((name) =>
    join(abs, name)
  );
  const optional = recommendedMacReleaseBlockmapNames(v).map((name) =>
    join(abs, name)
  );
  for (const file of required) {
    await access(file);
  }
  /** @type {string[]} */
  const files = [...required];
  for (const file of optional) {
    try {
      await access(file);
      files.push(file);
    } catch {
      // blockmaps are optional
    }
  }
  return files;
}

/**
 * @param {{ dir: string, version: string, policy: string }} opts
 */
export async function publishMacReleaseArtifacts(opts) {
  const version = normalizeReleaseVersion(opts.version);
  const policy = opts.policy || "always";
  if (policy === "never") {
    throw new Error("publish policy is never; refusing to upload");
  }

  const local = await validateMacReleaseDir(opts.dir, version);
  if (local.errors.length > 0) {
    throw new Error(local.errors.join("\n"));
  }

  const files = await collectPublishFiles(opts.dir, version);
  const electronBuilderPublishUrl = pathToFileURL(
    resolve("node_modules/electron-builder/out/publish.js")
  ).href;
  const { publishArtifactsWithOptions } = await import(
    electronBuilderPublishUrl
  );

  /** @type {Array<{ file: string, arch: null }>} */
  const uploadTasks = files.map((file) => ({ file, arch: null }));
  const result = await publishArtifactsWithOptions(
    uploadTasks,
    version,
    null,
    undefined,
    { publish: policy }
  );
  if (result == null) {
    throw new Error(
      "electron-builder publish returned null (upload failed; see logs above)"
    );
  }
  return {
    version,
    files: files.map((f) => basename(f)),
    uploaded: result,
  };
}

/**
 * @param {string[]} [argv]
 */
async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(
      "Usage: publish-mac-release-artifacts.mjs --dir dist-builder --version X.Y.Z --policy always"
    );
    process.exit(0);
  }
  if (!opts.dir || !opts.version) {
    console.error(
      "[publish-mac-release-artifacts] --dir and --version are required"
    );
    process.exit(2);
  }
  const result = await publishMacReleaseArtifacts({
    dir: opts.dir,
    version: opts.version,
    policy: opts.policy || "always",
  });
  console.log(
    `[publish-mac-release-artifacts] ok: published ${result.files.join(", ")}`
  );
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(
      "[publish-mac-release-artifacts]",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
