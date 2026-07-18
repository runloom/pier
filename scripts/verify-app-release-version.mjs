#!/usr/bin/env node
/**
 * Ensure a release tag version matches package.json.
 * Usage: node scripts/verify-app-release-version.mjs <versionWithoutV>
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const versionArg = process.argv[2];
if (!versionArg || versionArg.trim() === "") {
  console.error(
    "[verify-app-release-version] missing version argument (no leading v)"
  );
  process.exit(2);
}

const normalized = versionArg.startsWith("v")
  ? versionArg.slice(1)
  : versionArg;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageVersion = pkg.version;

if (packageVersion !== normalized) {
  console.error(
    `[verify-app-release-version] package.json version ${packageVersion} != tag version ${normalized}`
  );
  process.exit(1);
}

console.log(
  `[verify-app-release-version] ok: package.json ${packageVersion} matches release ${normalized}`
);
