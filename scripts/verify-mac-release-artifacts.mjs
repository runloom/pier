/**
 * Hard gate: local dist-builder (or an asset name list) must contain the full
 * dual-arch mac host release set before publish / release acceptance.
 *
 * Usage:
 *   node scripts/verify-mac-release-artifacts.mjs --dir dist-builder --version 0.1.1
 *   node scripts/verify-mac-release-artifacts.mjs --version 0.1.1 --assets a,b,c
 */
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCompiledIconIntegrity,
  assertCompiledIconStack,
  MAC_ICON_RENDITION_NAME,
} from "./app-icon-layered.mjs";
import {
  MAC_HELPER_SUFFIXES,
  rootPlistStringValue,
} from "./mac-helper-icons.mjs";
import {
  MAC_FOLDER_USAGE_DESCRIPTIONS,
  MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS,
  MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS,
  renderInfoPlistStrings,
} from "./mac-privacy-descriptions.mjs";
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

async function readPlistValue(plistPath, key) {
  if (process.platform === "darwin") {
    const result = spawnSync(
      "plutil",
      ["-extract", key, "raw", "-o", "-", plistPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    if (!result.error && result.status === 0) {
      return result.stdout.trim();
    }
    return;
  }
  try {
    return rootPlistStringValue(await readFile(plistPath, "utf8"), key);
  } catch {
    return;
  }
}

async function validatePackagedMacHelpers(app, canonicalIcon) {
  const errors = [];
  for (const suffix of MAC_HELPER_SUFFIXES) {
    const helperName = `Pier Helper${suffix}.app`;
    const helperContents = join(
      app,
      "Contents",
      "Frameworks",
      helperName,
      "Contents"
    );
    const plistPath = join(helperContents, "Info.plist");
    const resources = join(helperContents, "Resources");
    try {
      await readFile(plistPath);
    } catch (error) {
      errors.push(
        `${helperName}: missing readable Contents/Info.plist (${error instanceof Error ? error.message : String(error)})`
      );
      continue;
    }

    const iconFile = await readPlistValue(plistPath, "CFBundleIconFile");
    if (iconFile !== "icon.icns") {
      errors.push(
        `${helperName}: CFBundleIconFile must be icon.icns (received ${iconFile ?? "missing"})`
      );
    }
    const iconName = await readPlistValue(plistPath, "CFBundleIconName");
    if (iconName !== undefined) {
      errors.push(
        `${helperName}: CFBundleIconName must be absent for the ICNS-only Helper (received ${iconName})`
      );
    }

    try {
      const [helperIcon, canonicalIconBytes] = await Promise.all([
        readFile(join(resources, "icon.icns")),
        readFile(canonicalIcon),
      ]);
      if (!helperIcon.equals(canonicalIconBytes)) {
        errors.push(`${helperName}: icon.icns does not match build/icon.icns`);
      }
    } catch (error) {
      errors.push(
        `${helperName}: cannot compare icon.icns (${error instanceof Error ? error.message : String(error)})`
      );
    }

    for (const stale of ["Assets.car", "electron.icns", "AppIcon.icns"]) {
      try {
        await readFile(join(resources, stale));
        errors.push(
          `${helperName}: ${stale} must be absent; Helpers use only icon.icns`
        );
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          errors.push(
            `${helperName}: cannot verify ${stale} is absent (${error instanceof Error ? error.message : String(error)})`
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Verify the application bundle that electron-builder actually produced, not
 * only its release filenames. The packaged icon bytes must be identical to the
 * canonical generated outputs and the native catalog must remain inspectable.
 *
 * @param {string} appPath
 * @param {{ buildDirectory?: string, validateCar?: (path: string) => void }} [options]
 * @returns {Promise<string[]>}
 */
export async function validatePackagedMacApp(appPath, options = {}) {
  const app = resolve(appPath);
  const buildDirectory = resolve(options.buildDirectory ?? "build");
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  const errors = [];
  const plistPath = join(contents, "Info.plist");
  try {
    await readFile(plistPath);
  } catch (error) {
    return [
      `${appPath}: missing readable Contents/Info.plist (${error instanceof Error ? error.message : String(error)})`,
    ];
  }

  const bundleIdentifier = await readPlistValue(
    plistPath,
    "CFBundleIdentifier"
  );
  if (bundleIdentifier !== "io.pier.app") {
    errors.push(
      `${appPath}: CFBundleIdentifier must be io.pier.app (received ${bundleIdentifier ?? "missing"})`
    );
  }
  const packageType = await readPlistValue(plistPath, "CFBundlePackageType");
  if (packageType !== "APPL") {
    errors.push(
      `${appPath}: CFBundlePackageType must be APPL (received ${packageType ?? "missing"})`
    );
  }
  const iconFile = await readPlistValue(plistPath, "CFBundleIconFile");
  if (!(iconFile === "icon" || iconFile === "icon.icns")) {
    errors.push(
      `${appPath}: CFBundleIconFile must resolve to icon.icns (received ${iconFile ?? "missing"})`
    );
  }
  const iconName = await readPlistValue(plistPath, "CFBundleIconName");
  if (iconName !== MAC_ICON_RENDITION_NAME) {
    errors.push(
      `${appPath}: CFBundleIconName must be ${MAC_ICON_RENDITION_NAME} (received ${iconName ?? "missing"})`
    );
  }

  // TCC folder prompts show these strings as the only explanation for the
  // permission request; a bundle without them ships the silent
  // "Operation not permitted" terminal experience. English lives in the
  // Info.plist (locale fallback), Simplified Chinese in zh-Hans.lproj.
  for (const [key, expected] of Object.entries(MAC_FOLDER_USAGE_DESCRIPTIONS)) {
    const usage = await readPlistValue(plistPath, key);
    if (usage !== expected) {
      errors.push(
        `${appPath}: ${key} must match scripts/mac-privacy-descriptions.mjs (received ${usage ?? "missing"})`
      );
    }
  }
  for (const relative of MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS) {
    const localizedStringsPath = join(resources, ...relative.split("/"));
    try {
      const localized = await readFile(localizedStringsPath, "utf8");
      if (
        localized !==
        renderInfoPlistStrings(MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS)
      ) {
        errors.push(
          `${appPath}: ${relative} drifted from scripts/mac-privacy-descriptions.mjs (run: node scripts/mac-privacy-descriptions.mjs --write)`
        );
      }
    } catch (error) {
      errors.push(
        `${appPath}: missing ${relative} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  const packagedIcon = join(resources, "icon.icns");
  const packagedCar = join(resources, "Assets.car");
  const canonicalIcon = join(buildDirectory, "icon.icns");
  const canonicalCar = join(buildDirectory, "Assets.car");
  for (const [label, packaged, canonical] of [
    ["icon.icns", packagedIcon, canonicalIcon],
    ["Assets.car", packagedCar, canonicalCar],
  ]) {
    try {
      const [packagedBytes, canonicalBytes] = await Promise.all([
        readFile(packaged),
        readFile(canonical),
      ]);
      if (!packagedBytes.equals(canonicalBytes)) {
        errors.push(
          `${appPath}: packaged ${label} does not match ${canonical.replace(`${process.cwd()}/`, "")}`
        );
      }
    } catch (error) {
      errors.push(
        `${appPath}: cannot compare packaged ${label} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  if (!errors.some((error) => error.includes("Assets.car"))) {
    try {
      const validateCar =
        options.validateCar ??
        (process.platform === "darwin"
          ? (path) => {
              assertCompiledIconStack(path);
              assertCompiledIconIntegrity(path);
            }
          : undefined);
      validateCar?.(packagedCar);
    } catch (error) {
      errors.push(
        `${appPath}: packaged Assets.car is invalid (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
  errors.push(...(await validatePackagedMacHelpers(app, canonicalIcon)));
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
  for (const relativeApp of ["mac/Pier.app", "mac-arm64/Pier.app"]) {
    errors.push(
      ...(await validatePackagedMacApp(join(abs, relativeApp), {
        buildDirectory: resolve("build"),
      }))
    );
  }
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
