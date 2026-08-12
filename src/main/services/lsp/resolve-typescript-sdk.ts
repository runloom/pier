import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUnpackedAsarPath } from "./providers/typescript-provider.ts";
import { resolveCommandOnPath } from "./resolve-command.ts";

/**
 * Vue Language Tools embed classic TypeScript (`ts.server.protocol`).
 * TypeScript 7+ drops that surface; Microsoft still points Vue tooling at TS 6.
 * @see https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
 */
const MAX_COMPATIBLE_TYPESCRIPT_MAJOR = 6;

function typescriptMajorFromPackageJson(
  packageJsonPath: string
): number | null {
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const version = (JSON.parse(raw) as { version?: string }).version;
    if (!version) {
      return null;
    }
    const major = Number.parseInt(version.split(".")[0] ?? "", 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

function isVueCompatibleTypescriptPackage(packageJsonPath: string): boolean {
  const major = typescriptMajorFromPackageJson(packageJsonPath);
  if (major === null) {
    return false;
  }
  return major >= 1 && major <= MAX_COMPATIBLE_TYPESCRIPT_MAJOR;
}

function libDirFromTypescriptPackage(packageJsonPath: string): string | null {
  const lib = resolveUnpackedAsarPath(join(dirname(packageJsonPath), "lib"));
  if (!existsSync(join(lib, "typescript.js"))) {
    return null;
  }
  return lib;
}

/**
 * Resolve a TypeScript `lib/` directory for Vue LS `--tsdk=`.
 * Prefer a workspace-compatible install; always fall back to Pier's bundled TS 6.
 */
export function resolveTypescriptSdkLibForVue(
  workspaceRoot?: string
): string | null {
  const searchRoots: string[] = [];
  if (workspaceRoot && workspaceRoot.length > 0) {
    searchRoots.push(workspaceRoot);
  }
  // Pier app modules (dev + packaged main).
  searchRoots.push(dirname(fileURLToPath(import.meta.url)));

  for (const root of searchRoots) {
    try {
      const packageJson = createRequire(join(root, "package.json")).resolve(
        "typescript/package.json"
      );
      if (!isVueCompatibleTypescriptPackage(packageJson)) {
        continue;
      }
      const lib = libDirFromTypescriptPackage(packageJson);
      if (lib) {
        return lib;
      }
    } catch {
      // try next root
    }
  }

  // Explicit resolve from this module graph (same as main process deps).
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("typescript/package.json");
    if (isVueCompatibleTypescriptPackage(packageJson)) {
      return libDirFromTypescriptPackage(packageJson);
    }
  } catch {
    // bundled typescript missing
  }
  return null;
}

function pluginDirFromPackageJson(packageJsonPath: string): string | null {
  const dir = resolveUnpackedAsarPath(dirname(packageJsonPath));
  return existsSync(join(dir, "package.json")) ? dir : null;
}

/**
 * Resolve `@vue/typescript-plugin` package root for typescript-language-server
 * `initializationOptions.plugins`. Vue LS 3 hybrid needs this plugin under TLS
 * so go-to-definition works without a client-side tsserver bridge.
 *
 * Search order: workspace → vue-language-server install tree → global plugin.
 */
export function resolveVueTypescriptPluginLocation(
  workspaceRoot?: string
): string | null {
  const searchRoots: string[] = [];
  if (workspaceRoot && workspaceRoot.length > 0) {
    searchRoots.push(workspaceRoot);
  }
  searchRoots.push(dirname(fileURLToPath(import.meta.url)));

  for (const root of searchRoots) {
    try {
      const packageJson = createRequire(join(root, "package.json")).resolve(
        "@vue/typescript-plugin/package.json"
      );
      const dir = pluginDirFromPackageJson(packageJson);
      if (dir) {
        return dir;
      }
    } catch {
      // try next
    }
  }

  // Nested under a PATH vue-language-server install (common npm -g layout).
  const vueBin = resolveCommandOnPath("vue-language-server");
  if (vueBin) {
    try {
      const realBin = realpathSync(vueBin);
      // .../bin/vue-language-server.js → package root
      const vuePkgRoot = dirname(dirname(realBin));
      const nested = join(
        vuePkgRoot,
        "node_modules",
        "@vue",
        "typescript-plugin",
        "package.json"
      );
      if (existsSync(nested)) {
        return pluginDirFromPackageJson(nested);
      }
      // Some installs hoist plugin next to language-server.
      const hoisted = join(
        dirname(vuePkgRoot),
        "@vue",
        "typescript-plugin",
        "package.json"
      );
      if (existsSync(hoisted)) {
        return pluginDirFromPackageJson(hoisted);
      }
      try {
        const packageJson = createRequire(
          join(vuePkgRoot, "package.json")
        ).resolve("@vue/typescript-plugin/package.json");
        return pluginDirFromPackageJson(packageJson);
      } catch {
        // continue
      }
    } catch {
      // PATH entry unusable
    }
  }

  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("@vue/typescript-plugin/package.json");
    return pluginDirFromPackageJson(packageJson);
  } catch {
    return null;
  }
}
