import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Conditions for browser ESM bundling.
 * Must NOT include "node" / "worker" / "require" — those select SSR builds
 * (e.g. solid-js/web → server.cjs, svelte → index-server.js).
 */
const BROWSER_EXPORT_CONDITIONS = [
  "browser",
  "import",
  "module",
  "default",
] as const;

function parentModulePath(fromDirOrFile: string): string {
  // createRequire wants a file URL/path; package.json need not exist.
  if (
    fromDirOrFile.endsWith(".json") ||
    fromDirOrFile.endsWith(".js") ||
    fromDirOrFile.endsWith(".cjs") ||
    fromDirOrFile.endsWith(".mjs") ||
    fromDirOrFile.endsWith(".ts") ||
    fromDirOrFile.endsWith(".tsx") ||
    fromDirOrFile.endsWith(".vue") ||
    fromDirOrFile.endsWith(".svelte")
  ) {
    return fromDirOrFile;
  }
  return join(fromDirOrFile, "package.json");
}

function splitPackageSpecifier(specifier: string): {
  name: string;
  subpath: string;
} | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null;
  }
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null;
    }
    const name = `${parts[0]}/${parts[1]}`;
    const rest = parts.slice(2).join("/");
    return { name, subpath: rest ? `./${rest}` : "." };
  }
  const slash = specifier.indexOf("/");
  if (slash === -1) {
    return { name: specifier, subpath: "." };
  }
  return {
    name: specifier.slice(0, slash),
    subpath: `./${specifier.slice(slash + 1)}`,
  };
}

function resolveExportTarget(
  target: unknown,
  conditions: readonly string[]
): string | null {
  if (target == null) {
    return null;
  }
  if (typeof target === "string") {
    return target;
  }
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveExportTarget(item, conditions);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }
  if (typeof target === "object") {
    const record = target as Record<string, unknown>;
    for (const condition of conditions) {
      if (Object.hasOwn(record, condition)) {
        const resolved = resolveExportTarget(record[condition], conditions);
        if (resolved) {
          return resolved;
        }
      }
    }
    if (Object.hasOwn(record, "default")) {
      return resolveExportTarget(record.default, conditions);
    }
  }
  return null;
}

/**
 * Match package.json "exports" for a subpath under browser/import conditions.
 */
export function matchPackageExports(
  exportsField: unknown,
  subpath: string,
  conditions: readonly string[] = BROWSER_EXPORT_CONDITIONS
): string | null {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return subpath === "."
      ? resolveExportTarget(exportsField, conditions)
      : null;
  }
  if (!exportsField || typeof exportsField !== "object") {
    return null;
  }
  const record = exportsField as Record<string, unknown>;
  const keys = Object.keys(record);
  const isPathMap = keys.some((key) => key.startsWith("."));
  if (!isPathMap) {
    return subpath === "."
      ? resolveExportTarget(exportsField, conditions)
      : null;
  }
  if (Object.hasOwn(record, subpath)) {
    return resolveExportTarget(record[subpath], conditions);
  }
  // Limited * pattern support (e.g. "./*": "./dist/*")
  for (const key of keys) {
    if (!key.includes("*")) {
      continue;
    }
    const star = key.indexOf("*");
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!(subpath.startsWith(prefix) && subpath.endsWith(suffix))) {
      continue;
    }
    const capture = subpath.slice(
      prefix.length,
      subpath.length - suffix.length
    );
    const matched = resolveExportTarget(record[key], conditions);
    if (matched) {
      return matched.replaceAll("*", capture);
    }
  }
  return null;
}

function findPackageJsonPath(
  requireFn: NodeJS.Require,
  packageName: string
): string | null {
  try {
    return requireFn.resolve(`${packageName}/package.json`);
  } catch {
    // package.json may be blocked by "exports" — walk resolve.paths.
  }
  const searchPaths = requireFn.resolve.paths(packageName);
  if (!searchPaths) {
    return null;
  }
  for (const base of searchPaths) {
    const candidate = join(base, packageName, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function tryRealpath(absolutePath: string): string | null {
  try {
    if (!existsSync(absolutePath)) {
      return null;
    }
    return realpathSync(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Resolve a bare package entry for **browser bundling** from a project (or
 * importer) context — not Pier host node_modules.
 *
 * Uses package exports with browser/import conditions so Solid/Svelte pick
 * client builds (web.js / index-client.js) instead of Node SSR entries.
 *
 * `fromDirOrFile` should be the importer path or resolveDir so transitive deps
 * (e.g. seroval under solid-js) resolve via pnpm's nested layout.
 */
export function resolveProjectPackage(
  fromDirOrFile: string,
  specifier: string
): string | null {
  try {
    const parent = parentModulePath(fromDirOrFile);
    const requireFn = createRequire(pathToFileURL(parent).href);
    const parsed = splitPackageSpecifier(specifier);
    if (!parsed) {
      return null;
    }

    const pkgJsonPath = findPackageJsonPath(requireFn, parsed.name);
    if (!pkgJsonPath) {
      // Last resort: Node resolve (may hit server builds).
      try {
        return requireFn.resolve(specifier);
      } catch {
        return null;
      }
    }

    const pkgDir = dirname(pkgJsonPath);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      browser?: string | Record<string, string | false>;
      exports?: unknown;
      main?: string;
      module?: string;
    };

    if (pkg.exports) {
      const rel = matchPackageExports(pkg.exports, parsed.subpath);
      if (rel) {
        const abs = tryRealpath(normalize(join(pkgDir, rel)));
        if (abs) {
          return abs;
        }
      }
    }

    if (parsed.subpath === ".") {
      let main: string | undefined;
      if (typeof pkg.browser === "string") {
        main = pkg.browser;
      } else if (pkg.module) {
        main = pkg.module;
      } else if (pkg.main) {
        main = pkg.main;
      }
      if (main) {
        const abs = tryRealpath(normalize(join(pkgDir, main)));
        if (abs) {
          return abs;
        }
      }
    }

    // browser field map (legacy): only remap when we have a Node resolve path
    try {
      const nodeResolved = requireFn.resolve(specifier);
      if (pkg.browser && typeof pkg.browser === "object") {
        const relFromPkg = nodeResolved.startsWith(pkgDir)
          ? `./${nodeResolved.slice(pkgDir.length + 1).replaceAll("\\", "/")}`
          : null;
        if (relFromPkg && Object.hasOwn(pkg.browser, relFromPkg)) {
          const mapped = pkg.browser[relFromPkg];
          if (mapped === false) {
            return null;
          }
          if (typeof mapped === "string") {
            const abs = tryRealpath(normalize(join(pkgDir, mapped)));
            if (abs) {
              return abs;
            }
          }
        }
        if (Object.hasOwn(pkg.browser, specifier)) {
          const mapped = pkg.browser[specifier];
          if (mapped === false) {
            return null;
          }
          if (typeof mapped === "string" && !mapped.startsWith(".")) {
            return resolveProjectPackage(fromDirOrFile, mapped);
          }
          if (typeof mapped === "string") {
            const abs = tryRealpath(normalize(join(pkgDir, mapped)));
            if (abs) {
              return abs;
            }
          }
        }
      }
      return nodeResolved;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Load a package in Node (compilers: @vue/compiler-sfc, svelte/compiler).
 * Uses normal Node conditions — not browser exports.
 */
export function requireProjectPackage<T>(
  projectRoot: string,
  specifier: string
): T | null {
  try {
    const requireFn = createRequire(
      pathToFileURL(join(projectRoot, "package.json")).href
    );
    return requireFn(specifier) as T;
  } catch {
    return null;
  }
}
