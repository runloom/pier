/**
 * Hard gate: a packed Pier.app must unpack Tailwind JIT natives (oxide /
 * lightningcss) next to esbuild, and those addons must actually load.
 *
 * Usage:
 *   node scripts/verify-canvas-tailwind-native-unpack.mjs --dir dist-builder
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const JS_PACKAGES = ["@tailwindcss/node", "@tailwindcss/oxide", "lightningcss"];

const NATIVE_PACKAGE_RE = /^(?:@tailwindcss\/oxide-|lightningcss-)[a-z0-9-]+$/u;

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ dir?: string, help?: boolean }} */
  const out = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--dir") {
      i += 1;
      out.dir = args[i];
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
    i += 1;
  }
  return out;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function findPierApps(root) {
  /** @type {string[]} */
  const apps = [];
  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (depth > 6) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "node_modules.asar.unpacked"
      ) {
        continue;
      }
      const next = join(dir, entry.name);
      if (
        entry.name.endsWith(".app") &&
        existsSync(join(next, "Contents", "MacOS"))
      ) {
        apps.push(next);
        continue;
      }
      walk(next, depth + 1);
    }
  }
  walk(root, 0);
  return apps.sort();
}

/**
 * @param {string} appPath
 */
export function unpackedResourcesDir(appPath) {
  return join(appPath, "Contents", "Resources", "app.asar.unpacked");
}

/**
 * @param {string} root
 * @param {readonly string[]} names
 * @returns {Map<string, string>}
 */
export function findPackageDirs(root, names) {
  const wanted = new Set(names);
  /** @type {Map<string, string>} */
  const found = new Map();
  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (found.size === wanted.size || depth > 14) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.size === wanted.size) {
        return;
      }
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".bin" || entry.name === "dist") {
          continue;
        }
        walk(next, depth + 1);
        continue;
      }
      if (entry.name !== "package.json") {
        continue;
      }
      try {
        const pkg = JSON.parse(readFileSync(next, "utf8"));
        if (
          typeof pkg.name === "string" &&
          wanted.has(pkg.name) &&
          !found.has(pkg.name)
        ) {
          found.set(pkg.name, dirname(next));
        }
      } catch {
        // ignore malformed package.json in the walk
      }
    }
  }
  walk(root, 0);
  return found;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function findNativeAddonFiles(root) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (depth > 14) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(next, depth + 1);
        continue;
      }
      if (entry.name.endsWith(".node")) {
        files.push(next);
      }
    }
  }
  walk(root, 0);
  return files.sort();
}

/**
 * electron-builder mac output: `mac-arm64/` is Apple Silicon, `mac/` is Intel.
 *
 * @param {string} appPath
 * @returns {"arm64" | "x64" | null}
 */
export function inferMacAppArch(appPath) {
  const normalized = appPath.replaceAll("\\", "/");
  if (normalized.includes("/mac-arm64/")) {
    return "arm64";
  }
  if (normalized.includes("/mac-x64/")) {
    return "x64";
  }
  if (/\/mac\/[^/]+\.app(?:\/|$)/.test(normalized)) {
    return "x64";
  }
  return null;
}

/**
 * @param {string} unpackedRoot
 * @param {{ arch?: "arm64" | "x64" | null }} [options]
 * @returns {string[]}
 */
export function collectUnpackErrors(unpackedRoot, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!existsSync(unpackedRoot)) {
    errors.push(`missing unpacked resources: ${unpackedRoot}`);
    return errors;
  }
  const packages = findPackageDirs(unpackedRoot, [
    ...JS_PACKAGES,
    // Platform optional deps are discovered by name prefix below.
  ]);
  for (const name of JS_PACKAGES) {
    if (!packages.has(name)) {
      errors.push(`unpacked tree is missing package ${name}`);
    }
  }
  const nativePackages = findPackageDirsByPattern(
    unpackedRoot,
    NATIVE_PACKAGE_RE
  );
  const oxideNative = [...nativePackages.keys()].filter((name) =>
    name.startsWith("@tailwindcss/oxide-")
  );
  const lightningNative = [...nativePackages.keys()].filter((name) =>
    name.startsWith("lightningcss-")
  );
  const arch = options.arch ?? null;
  if (arch) {
    const oxideName = `@tailwindcss/oxide-darwin-${arch}`;
    const lightningName = `lightningcss-darwin-${arch}`;
    if (!oxideNative.includes(oxideName)) {
      errors.push(`unpacked tree is missing ${oxideName}`);
    }
    if (!lightningNative.includes(lightningName)) {
      errors.push(`unpacked tree is missing ${lightningName}`);
    }
  } else if (oxideNative.length === 0) {
    errors.push("unpacked tree is missing @tailwindcss/oxide-* native package");
  }
  if (!arch && lightningNative.length === 0) {
    errors.push("unpacked tree is missing lightningcss-* native package");
  }
  const addons = findNativeAddonFiles(unpackedRoot);
  if (
    !(
      addons.some((path) => path.includes("tailwindcss-oxide")) ||
      addons.some((path) => /oxide.*\.node$/u.test(path))
    )
  ) {
    errors.push("unpacked tree has no oxide .node addon");
  }
  if (!addons.some((path) => path.includes("lightningcss"))) {
    errors.push("unpacked tree has no lightningcss .node addon");
  }
  const esbuildBin = findEsbuildBinary(unpackedRoot, arch);
  if (!esbuildBin) {
    errors.push(
      arch
        ? `unpacked tree is missing @esbuild/darwin-${arch}/bin/esbuild`
        : "unpacked tree is missing @esbuild/*/bin/esbuild"
    );
  } else if (!statSync(esbuildBin).isFile()) {
    errors.push(`esbuild binary is not a file: ${esbuildBin}`);
  }
  return errors;
}

/**
 * @param {string} root
 * @param {RegExp} pattern
 * @returns {Map<string, string>}
 */
function findPackageDirsByPattern(root, pattern) {
  /** @type {Map<string, string>} */
  const found = new Map();
  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (depth > 14) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".bin") {
          continue;
        }
        walk(next, depth + 1);
        continue;
      }
      if (entry.name !== "package.json") {
        continue;
      }
      try {
        const pkg = JSON.parse(readFileSync(next, "utf8"));
        if (
          typeof pkg.name === "string" &&
          pattern.test(pkg.name) &&
          !found.has(pkg.name)
        ) {
          found.set(pkg.name, dirname(next));
        }
      } catch {
        // ignore
      }
    }
  }
  walk(root, 0);
  return found;
}

/**
 * @param {string} unpackedRoot
 * @param {"arm64" | "x64" | null} [arch]
 */
function findEsbuildBinary(unpackedRoot, arch = null) {
  const binName = process.platform === "win32" ? "esbuild.exe" : "esbuild";
  const needle = arch ? `/darwin-${arch}/` : "/@esbuild/";
  /** @type {string | null} */
  let found = null;
  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (found || depth > 12) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found) {
        return;
      }
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(next, depth + 1);
        continue;
      }
      if (entry.name !== binName) {
        continue;
      }
      const normalized = next.replaceAll("\\", "/");
      if (
        normalized.includes("/@esbuild/") &&
        dirname(next).replaceAll("\\", "/").endsWith("/bin") &&
        normalized.includes(needle)
      ) {
        found = next;
      }
    }
  }
  walk(unpackedRoot, 0);
  return found;
}

/**
 * Load oxide + lightningcss from an unpacked tree (flattened or pnpm layout).
 *
 * @param {string} unpackedRoot
 * @param {{ arch?: "arm64" | "x64" | null }} [options]
 * @returns {string[]}
 */
export function loadUnpackedNatives(unpackedRoot, options = {}) {
  /** @type {string[]} */
  const errors = [];
  const expectedArch = options.arch ?? null;
  if (expectedArch && expectedArch !== process.arch) {
    // Other-arch pack on this host: existence is collectUnpackErrors' job.
    return errors;
  }
  const hostTag = `${process.platform}-${process.arch}`;
  const hostAddons = findNativeAddonFiles(unpackedRoot).filter((path) =>
    path.includes(hostTag)
  );
  if (hostAddons.length === 0) {
    // Other-arch pack on this host: existence is collectUnpackErrors' job.
    return errors;
  }
  const packages = findPackageDirs(unpackedRoot, JS_PACKAGES);
  const oxideDir = packages.get("@tailwindcss/oxide");
  const lightningDir = packages.get("lightningcss");
  if (oxideDir) {
    try {
      const require = createRequire(join(oxideDir, "package.json"));
      const oxide = require(join(oxideDir, "index.js"));
      if (typeof oxide.Scanner === "function") {
        const scanner = new oxide.Scanner({ sources: [] });
        scanner.scanFiles([]);
      } else {
        errors.push("@tailwindcss/oxide loaded but Scanner is missing");
      }
    } catch (error) {
      errors.push(
        `failed to load @tailwindcss/oxide: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (lightningDir) {
    try {
      const require = createRequire(join(lightningDir, "package.json"));
      const lightning = require(join(lightningDir, "node/index.js"));
      if (typeof lightning.transform === "function") {
        lightning.transform({
          code: Buffer.from(".a{color:red}"),
          filename: "probe.css",
        });
      } else {
        errors.push("lightningcss loaded but transform is missing");
      }
    } catch (error) {
      errors.push(
        `failed to load lightningcss: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return errors;
}

/**
 * @param {string} unpackedRoot
 */
export function verifyUnpackedRoot(unpackedRoot, options = {}) {
  const errors = [
    ...collectUnpackErrors(unpackedRoot, options),
    ...loadUnpackedNatives(unpackedRoot, options),
  ];
  return { errors, unpackedRoot };
}

/**
 * @param {string} distDir
 */
export function verifyDistBuilder(distDir) {
  const abs = resolve(distDir);
  if (!existsSync(abs)) {
    return {
      apps: [],
      errors: [`dist dir does not exist: ${abs}`],
    };
  }
  const apps = findPierApps(abs);
  if (apps.length === 0) {
    return {
      apps,
      errors: [
        `no Pier.app under ${abs} (pack with electron-builder --mac --dir or build:dist first)`,
      ],
    };
  }
  /** @type {string[]} */
  const errors = [];
  for (const app of apps) {
    const unpacked = unpackedResourcesDir(app);
    const result = verifyUnpackedRoot(unpacked, {
      arch: inferMacAppArch(app),
    });
    for (const error of result.errors) {
      errors.push(`${app}: ${error}`);
    }
  }
  return { apps, errors };
}

/**
 * @param {string[]} [argv]
 */
async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(
      "Usage: verify-canvas-tailwind-native-unpack.mjs --dir dist-builder"
    );
    process.exit(0);
  }
  if (!opts.dir) {
    console.error("[verify-canvas-tailwind-native-unpack] --dir is required");
    process.exit(2);
  }
  const result = verifyDistBuilder(opts.dir);
  if (result.errors.length > 0) {
    console.error("[verify-canvas-tailwind-native-unpack] FAILED:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `[verify-canvas-tailwind-native-unpack] ok: ${result.apps.length} app(s) load oxide + lightningcss from asar.unpacked`
  );
  for (const app of result.apps) {
    console.log(`  - ${app}`);
  }
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(
      "[verify-canvas-tailwind-native-unpack]",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
