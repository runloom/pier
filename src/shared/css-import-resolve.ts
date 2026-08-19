/**
 * Resolve CSS @import / @source specifiers the way bundlers do for Tailwind v4:
 * relative paths, package names, and package.json "exports" with "style" condition.
 */

import { dirname, isAbsolute, join, normalize } from "node:path";

export interface CssImportFs {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** Direct child names of a directory; empty when missing. */
  listDir(path: string): readonly string[];
  readJson(path: string): unknown | null;
}

export interface ResolveCssImportInput {
  /**
   * When true, relative/absolute paths that resolve to directories are returned
   * (for Tailwind `@source` content roots). Default false — `@import` wants files.
   */
  allowDirectory?: boolean;
  /** Absolute path of the file containing the @import / @source. */
  fromFilePath: string;
  fs: CssImportFs;
  specifier: string;
}

export interface ResolvedCssImportPath {
  isDirectory: boolean;
  path: string;
}

interface PackageJson {
  exports?: unknown;
  main?: unknown;
  name?: unknown;
  style?: unknown;
}

const STYLE_CONDITIONS = ["style", "import", "default", "require"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parsePackageName(specifier: string): {
  name: string;
  subpath: string;
} | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.includes("://")
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
    return { name, subpath: rest };
  }
  const slash = specifier.indexOf("/");
  if (slash === -1) {
    return { name: specifier, subpath: "" };
  }
  return {
    name: specifier.slice(0, slash),
    subpath: specifier.slice(slash + 1),
  };
}

function pickExportTarget(value: unknown, depth = 0): string | null {
  if (depth > 8) {
    return null;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = pickExportTarget(entry, depth + 1);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const condition of STYLE_CONDITIONS) {
    if (condition in record) {
      const hit = pickExportTarget(record[condition], depth + 1);
      if (hit) {
        return hit;
      }
    }
  }
  // Some packages only list nested paths without conditions.
  for (const nested of Object.values(record)) {
    if (
      typeof nested === "string" ||
      asRecord(nested) ||
      Array.isArray(nested)
    ) {
      const hit = pickExportTarget(nested, depth + 1);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

function resolveExportPath(
  exportsField: unknown,
  subpath: string
): string | null {
  const key = subpath === "" ? "." : `./${subpath.replace(/^\.\//u, "")}`;
  const record = asRecord(exportsField);
  if (!record) {
    if (typeof exportsField === "string" && subpath === "") {
      return exportsField;
    }
    return null;
  }
  if (key in record) {
    return pickExportTarget(record[key]);
  }
  // Try with .css suffix when bare subpath
  if (subpath && !subpath.endsWith(".css")) {
    const withCss = `./${subpath}.css`;
    if (withCss in record) {
      return pickExportTarget(record[withCss]);
    }
  }
  return null;
}

function packageJsonAt(
  fs: CssImportFs,
  packageDir: string
): PackageJson | null {
  const raw = fs.readJson(join(packageDir, "package.json"));
  return asRecord(raw) as PackageJson | null;
}

function candidateFiles(packageDir: string, relative: string): string[] {
  const cleaned = relative.replace(/^\.\//u, "");
  const base = join(packageDir, cleaned);
  const out = [base];
  if (!cleaned.endsWith(".css")) {
    out.push(`${base}.css`);
    out.push(join(base, "index.css"));
  }
  return out;
}

function firstExisting(
  fs: CssImportFs,
  candidates: readonly string[]
): string | null {
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (fs.exists(normalized) && !fs.isDirectory(normalized)) {
      return normalized;
    }
  }
  return null;
}

function resolveInsidePackage(
  fs: CssImportFs,
  packageDir: string,
  subpath: string
): string | null {
  const pkg = packageJsonAt(fs, packageDir);
  if (pkg?.exports !== undefined) {
    const exportTarget = resolveExportPath(pkg.exports, subpath);
    if (exportTarget) {
      const hit = firstExisting(fs, candidateFiles(packageDir, exportTarget));
      if (hit) {
        return hit;
      }
    }
  }
  if (subpath === "") {
    if (typeof pkg?.style === "string") {
      const hit = firstExisting(fs, candidateFiles(packageDir, pkg.style));
      if (hit) {
        return hit;
      }
    }
    return firstExisting(fs, [
      join(packageDir, "index.css"),
      join(packageDir, "style.css"),
      join(packageDir, "styles.css"),
    ]);
  }
  return firstExisting(fs, candidateFiles(packageDir, subpath));
}

function findPackageDir(
  fs: CssImportFs,
  startDir: string,
  packageName: string
): string | null {
  let dir = startDir;
  for (let i = 0; i < 64; i += 1) {
    const candidate = join(dir, "node_modules", packageName);
    if (fs.exists(candidate) && fs.isDirectory(candidate)) {
      // pnpm may nest package at node_modules/.pnpm/... via symlink; exists is enough.
      return candidate;
    }
    // Monorepo: dependency may only be installed under packages/*/node_modules
    // (e.g. mermaid under packages/ui while globals.css is in src/).
    const packagesDir = join(dir, "packages");
    if (fs.exists(packagesDir) && fs.isDirectory(packagesDir)) {
      for (const entry of fs.listDir(packagesDir)) {
        if (entry.startsWith(".")) {
          continue;
        }
        const nested = join(packagesDir, entry, "node_modules", packageName);
        if (fs.exists(nested) && fs.isDirectory(nested)) {
          return nested;
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * Resolve a CSS import specifier to an absolute filesystem path, or null.
 */
export function resolveCssImportPath(
  input: ResolveCssImportInput
): ResolvedCssImportPath | null {
  const specifier = input.specifier.trim();
  if (
    specifier.length === 0 ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    specifier.startsWith("data:")
  ) {
    return null;
  }

  const fromDir = dirname(input.fromFilePath);
  const { fs } = input;
  const allowDirectory = input.allowDirectory === true;

  // Relative / absolute file or directory path
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    isAbsolute(specifier)
  ) {
    const target = isAbsolute(specifier)
      ? normalize(specifier)
      : normalize(join(fromDir, specifier));
    if (fs.exists(target) && fs.isDirectory(target)) {
      return allowDirectory ? { isDirectory: true, path: target } : null;
    }
    const withCss = target.endsWith(".css") ? target : `${target}.css`;
    if (fs.exists(withCss) && !fs.isDirectory(withCss)) {
      return { isDirectory: false, path: withCss };
    }
    if (fs.exists(target) && !fs.isDirectory(target)) {
      return { isDirectory: false, path: target };
    }
    return null;
  }

  const parsed = parsePackageName(specifier);
  if (!parsed) {
    return null;
  }
  const packageDir = findPackageDir(fs, fromDir, parsed.name);
  if (!packageDir) {
    return null;
  }
  const filePath = resolveInsidePackage(fs, packageDir, parsed.subpath);
  return filePath ? { isDirectory: false, path: filePath } : null;
}
