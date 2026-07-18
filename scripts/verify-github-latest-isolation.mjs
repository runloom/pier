#!/usr/bin/env node
/**
 * Hard gate: GitHub /releases/latest must stay the host app channel.
 *
 * Plugin releases use tags like plugin-codex-v1.3.1 and must never become
 * Latest — electron-updater only reads /releases/latest for latest-mac.yml.
 *
 * Usage:
 *   node scripts/verify-github-latest-isolation.mjs
 *   node scripts/verify-github-latest-isolation.mjs --repo owner/name
 *   node scripts/verify-github-latest-isolation.mjs --expect-version 0.1.1
 *   node scripts/verify-github-latest-isolation.mjs --plugin-tags plugin-codex-v1.3.1,plugin-grok-v1.0.1
 *
 * Requires: gh auth (GH_TOKEN or gh login).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_TAG_RE = /^plugin-/i;
const HOST_TAG_RE = /^v\d+\.\d+\.\d+/;

/**
 * @param {unknown} latest
 * @param {{ expectVersion?: string }} [opts]
 * @returns {string[]}
 */
export function validateLatestRelease(latest, opts = {}) {
  const errors = [];
  if (!latest || typeof latest !== "object") {
    errors.push("latest release payload missing");
    return errors;
  }
  const record = /** @type {Record<string, unknown>} */ (latest);
  const tag =
    typeof record.tag_name === "string"
      ? record.tag_name
      : typeof record.tagName === "string"
        ? record.tagName
        : "";
  const draft = Boolean(record.draft);
  const prerelease = Boolean(record.prerelease);
  const assetsRaw = Array.isArray(record.assets) ? record.assets : [];
  const assetNames = assetsRaw
    .map((a) => {
      if (!a || typeof a !== "object") return "";
      const name = /** @type {Record<string, unknown>} */ (a).name;
      return typeof name === "string" ? name : "";
    })
    .filter(Boolean);

  if (!tag) {
    errors.push("latest release has empty tag_name");
  }
  if (PLUGIN_TAG_RE.test(tag)) {
    errors.push(
      `latest release tag is a plugin tag (${tag}); host updater would miss latest-mac.yml`
    );
  }
  if (tag && !HOST_TAG_RE.test(tag)) {
    errors.push(
      `latest release tag ${tag} is not a host semver tag (expected vX.Y.Z)`
    );
  }
  if (draft) {
    errors.push(`latest release ${tag || "(unknown)"} is draft`);
  }
  if (prerelease) {
    errors.push(
      `latest release ${tag || "(unknown)"} is prerelease; host channel must be a full release`
    );
  }
  if (!assetNames.includes("latest-mac.yml")) {
    errors.push(
      `latest release ${tag || "(unknown)"} missing latest-mac.yml (assets: ${assetNames.join(", ") || "none"})`
    );
  }
  if (opts.expectVersion) {
    const expectedTag = opts.expectVersion.startsWith("v")
      ? opts.expectVersion
      : `v${opts.expectVersion}`;
    if (tag !== expectedTag) {
      errors.push(
        `latest tag is ${tag || "(none)"}, expected ${expectedTag}`
      );
    }
    const version = expectedTag.slice(1);
    const hasZip = assetNames.some(
      (name) =>
        name.includes(version) &&
        name.endsWith(".zip") &&
        name.toLowerCase().includes("mac")
    );
    if (!hasZip) {
      errors.push(
        `latest release missing mac zip for ${version} (assets: ${assetNames.join(", ") || "none"})`
      );
    }
  }
  return errors;
}

/**
 * @param {unknown} release
 * @param {string} tag
 * @returns {string[]}
 */
export function validatePluginReleaseIsolation(release, tag) {
  const errors = [];
  if (!PLUGIN_TAG_RE.test(tag)) {
    errors.push(`not a plugin tag: ${tag}`);
    return errors;
  }
  if (!release || typeof release !== "object") {
    errors.push(`plugin release ${tag} missing`);
    return errors;
  }
  const record = /** @type {Record<string, unknown>} */ (release);
  const draft = Boolean(record.draft);
  const prerelease = Boolean(record.prerelease);
  // GitHub JSON uses prerelease; some gh --json fields differ.
  if (draft) {
    errors.push(`plugin release ${tag} is draft`);
  }
  if (!prerelease) {
    errors.push(
      `plugin release ${tag} must be prerelease so it cannot become Latest`
    );
  }
  return errors;
}

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ repo?: string, expectVersion?: string, pluginTags: string[] }} */
  const out = { pluginTags: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--repo") {
      out.repo = args[++i];
    } else if (a === "--expect-version") {
      out.expectVersion = args[++i];
    } else if (a === "--plugin-tags") {
      const raw = args[++i] ?? "";
      out.pluginTags = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function ghJson(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(`gh ${args.join(" ")} failed: ${err || result.status}`);
  }
  return JSON.parse(result.stdout);
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(`Usage: verify-github-latest-isolation.mjs [--repo o/n] [--expect-version X.Y.Z] [--plugin-tags t1,t2]`);
    process.exit(0);
  }
  const repo = opts.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error(
      "[verify-github-latest-isolation] set --repo owner/name or GITHUB_REPOSITORY"
    );
    process.exit(2);
  }

  const errors = [];
  const latest = ghJson([
    "api",
    `repos/${repo}/releases/latest`,
  ]);
  errors.push(
    ...validateLatestRelease(latest, {
      ...(opts.expectVersion ? { expectVersion: opts.expectVersion } : {}),
    })
  );

  for (const tag of opts.pluginTags) {
    try {
      const release = ghJson([
        "api",
        `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      ]);
      errors.push(...validatePluginReleaseIsolation(release, tag));
    } catch (err) {
      errors.push(
        err instanceof Error ? err.message : `failed to load plugin tag ${tag}`
      );
    }
  }

  if (errors.length > 0) {
    console.error("[verify-github-latest-isolation] FAILED:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }
  const tag = latest.tag_name ?? latest.tagName;
  console.log(
    `[verify-github-latest-isolation] ok: latest=${tag} (host channel isolated)`
  );
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(
      "[verify-github-latest-isolation]",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }
}
