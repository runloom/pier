/**
 * Publish verified dual-arch mac artifacts via electron-builder.
 *
 * Why this wrapper exists:
 * 1. `electron-builder publish` catches upload errors, logs them, and can
 *    return null / exit 0 — leaving a partial GitHub Latest release green.
 * 2. GitHubPublisher silently skips all uploads when a non-draft release is
 *    older than 2h unless EP_GH_IGNORE_TIME=true (broken v0.1.1 case).
 *
 * Flow: local dual-arch gate → set EP_GH_IGNORE_TIME → publish → remote
 * dual-arch gate (hard-fail if Latest still incomplete).
 *
 * Usage:
 *   node scripts/publish-mac-release-artifacts.mjs --dir dist-builder --version 0.1.1 --policy always
 */
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  normalizeReleaseVersion,
  recommendedMacReleaseBlockmapNames,
  requiredMacReleaseAssetNames,
  validateMacReleaseAssetNames,
} from "./mac-release-assets.mjs";
import { validateMacReleaseDir } from "./verify-mac-release-artifacts.mjs";

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ dir?: string, version?: string, policy?: string, repo?: string, help?: boolean }} */
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
    } else if (a === "--repo") {
      i += 1;
      out.repo = args[i];
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
 * @param {string[]} ghArgs
 * @returns {unknown}
 */
function ghJson(ghArgs) {
  const result = spawnSync("gh", ghArgs, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(`gh ${ghArgs.join(" ")} failed: ${err || result.status}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * Read asset names from GitHub /releases/latest (or a tag release).
 * @param {{ repo: string, version: string, fetchJson?: (args: string[]) => unknown }} opts
 * @returns {string[]}
 */
export function fetchRemoteReleaseAssetNames(opts) {
  const version = normalizeReleaseVersion(opts.version);
  const tag = `v${version}`;
  const fetchJson = opts.fetchJson ?? ghJson;
  /** @type {unknown} */
  let release;
  try {
    release = fetchJson([
      "api",
      `repos/${opts.repo}/releases/tags/${encodeURIComponent(tag)}`,
    ]);
  } catch {
    // Fall back to Latest if the tag endpoint is missing mid-create.
    release = fetchJson(["api", `repos/${opts.repo}/releases/latest`]);
  }
  if (!release || typeof release !== "object") {
    throw new Error("remote release payload missing");
  }
  const record = /** @type {Record<string, unknown>} */ (release);
  let tagName = "";
  if (typeof record.tag_name === "string") {
    tagName = record.tag_name;
  } else if (typeof record.tagName === "string") {
    tagName = record.tagName;
  }
  if (tagName && tagName !== tag) {
    throw new Error(
      `remote release tag is ${tagName}, expected ${tag} (refusing to accept wrong release)`
    );
  }
  const assetsRaw = Array.isArray(record.assets) ? record.assets : [];
  return assetsRaw
    .map((a) => {
      if (!a || typeof a !== "object") {
        return "";
      }
      const name = /** @type {Record<string, unknown>} */ (a).name;
      return typeof name === "string" ? name : "";
    })
    .filter(Boolean);
}

/**
 * @param {{ assetNames: string[], version: string }} input
 * @returns {string[]}
 */
export function validateRemoteMacReleaseAssets(input) {
  return validateMacReleaseAssetNames(input.assetNames, input.version);
}

/**
 * @param {{
 *   dir: string,
 *   version: string,
 *   policy: string,
 *   repo?: string,
 *   publishImpl?: (tasks: Array<{ file: string, arch: null }>, version: string, policy: string) => Promise<unknown>,
 *   fetchRemoteAssetNames?: (opts: { repo: string, version: string }) => string[],
 * }} opts
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

  // electron-builder GitHubPublisher skips ALL uploads when a non-draft
  // release is older than 2 hours unless this is true. Re-publishing a
  // broken Latest (missing arm64 dmg) requires overwrite.
  process.env.EP_GH_IGNORE_TIME = "true";

  /** @type {Array<{ file: string, arch: null }>} */
  const uploadTasks = files.map((file) => ({ file, arch: null }));

  let result;
  if (opts.publishImpl) {
    result = await opts.publishImpl(uploadTasks, version, policy);
  } else {
    const electronBuilderPublishUrl = pathToFileURL(
      resolve("node_modules/electron-builder/out/publish.js")
    ).href;
    const { publishArtifactsWithOptions } = await import(
      electronBuilderPublishUrl
    );
    result = await publishArtifactsWithOptions(
      uploadTasks,
      version,
      null,
      undefined,
      { publish: policy }
    );
  }
  if (result == null) {
    throw new Error(
      "electron-builder publish returned null (upload failed; see logs above)"
    );
  }

  const repo =
    opts.repo ||
    process.env.GITHUB_REPOSITORY ||
    process.env.npm_package_repository ||
    "";
  if (!repo?.includes("/")) {
    throw new Error(
      "cannot verify remote assets: set --repo owner/name or GITHUB_REPOSITORY"
    );
  }

  const remoteNames = opts.fetchRemoteAssetNames
    ? opts.fetchRemoteAssetNames({ repo, version })
    : fetchRemoteReleaseAssetNames({ repo, version });
  const remoteErrors = validateRemoteMacReleaseAssets({
    assetNames: remoteNames,
    version,
  });
  if (remoteErrors.length > 0) {
    throw new Error(
      [
        "remote GitHub release still missing dual-arch mac assets after publish:",
        ...remoteErrors.map((e) => `  - ${e}`),
        `  remote assets: ${remoteNames.join(", ") || "none"}`,
        "  (electron-builder may have skipped uploads; EP_GH_IGNORE_TIME is forced true)",
      ].join("\n")
    );
  }

  return {
    version,
    repo,
    files: files.map((f) => basename(f)),
    remoteAssets: remoteNames,
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
      "Usage: publish-mac-release-artifacts.mjs --dir dist-builder --version X.Y.Z --policy always [--repo owner/name]"
    );
    process.exit(0);
  }
  if (!(opts.dir && opts.version)) {
    console.error(
      "[publish-mac-release-artifacts] --dir and --version are required"
    );
    process.exit(2);
  }
  const result = await publishMacReleaseArtifacts({
    dir: opts.dir,
    version: opts.version,
    policy: opts.policy || "always",
    ...(opts.repo ? { repo: opts.repo } : {}),
  });
  console.log(
    `[publish-mac-release-artifacts] ok: published ${result.files.join(", ")} → ${result.repo}@v${result.version}`
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
