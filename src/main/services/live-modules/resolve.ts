import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export interface TsconfigPathsConfig {
  absoluteBaseUrl: string;
  paths: Record<string, string[]>;
  tsconfigPath: string;
}

/**
 * Walk up from `fromDir` looking for tsconfig.app.json then tsconfig.json.
 * Fall back to `projectRoot/tsconfig.json`.
 */
export function findTsconfigPath(
  fromDir: string,
  projectRoot: string
): string | null {
  let current = fromDir;
  for (;;) {
    const appConfig = join(current, "tsconfig.app.json");
    if (existsSync(appConfig)) {
      return appConfig;
    }
    const config = join(current, "tsconfig.json");
    if (existsSync(config)) {
      return config;
    }
    if (current === projectRoot) {
      break;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const fallback = join(projectRoot, "tsconfig.json");
  return existsSync(fallback) ? fallback : null;
}

function stripJsonc(raw: string): string {
  return (
    raw
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "")
      // Trailing commas before } or ]
      .replace(/,(\s*[}\]])/gu, "$1")
  );
}

interface TsconfigJson {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  extends?: string | string[];
}

function readTsconfigJson(tsconfigPath: string): TsconfigJson {
  const raw = readFileSync(tsconfigPath, "utf8");
  return JSON.parse(stripJsonc(raw)) as TsconfigJson;
}

/**
 * Load compilerOptions.paths / baseUrl, following one chain of `extends`
 * (child wins). Stops at projectRoot boundary for extended files.
 */
export function loadTsconfigPaths(
  fromDir: string,
  projectRoot: string
): TsconfigPathsConfig | null {
  const tsconfigPath = findTsconfigPath(fromDir, projectRoot);
  if (!tsconfigPath) {
    return null;
  }

  let paths: Record<string, string[]> = {};
  let baseUrl = ".";
  let baseUrlConfigDir = dirname(tsconfigPath);
  let currentPath: string | null = tsconfigPath;
  const visited = new Set<string>();

  while (currentPath && !visited.has(currentPath)) {
    visited.add(currentPath);
    let parsed: TsconfigJson;
    try {
      parsed = readTsconfigJson(currentPath);
    } catch {
      break;
    }
    const compilerOptions = parsed.compilerOptions ?? {};
    // Child (first in chain) wins for paths/baseUrl once set; parents fill gaps.
    if (Object.keys(paths).length === 0 && compilerOptions.paths) {
      paths = compilerOptions.paths;
    }
    if (baseUrl === "." && compilerOptions.baseUrl) {
      baseUrl = compilerOptions.baseUrl;
      baseUrlConfigDir = dirname(currentPath);
    }

    const extendsField = parsed.extends;
    let extendsRel: string | undefined;
    if (typeof extendsField === "string") {
      extendsRel = extendsField;
    } else if (Array.isArray(extendsField)) {
      extendsRel = extendsField[0];
    }
    // Only relative same-tree extends; skip package names (e.g. @tsconfig/*).
    if (!extendsRel?.startsWith("./")) {
      break;
    }
    if (extendsRel.includes("..")) {
      break;
    }
    const next = join(dirname(currentPath), extendsRel);
    const withJson = next.endsWith(".json") ? next : `${next}.json`;
    if (!existsSync(withJson)) {
      break;
    }
    // Keep extended configs inside the project fence.
    const rel = relative(projectRoot, withJson);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      break;
    }
    currentPath = withJson;
  }

  const absoluteBaseUrl = join(baseUrlConfigDir, baseUrl);
  return {
    absoluteBaseUrl,
    paths,
    tsconfigPath,
  };
}

/** Map an import specifier through tsconfig paths; return absolute path candidates. */
export function mapSpecifierWithPaths(
  specifier: string,
  config: TsconfigPathsConfig
): string[] {
  const candidates: string[] = [];
  for (const [pattern, targets] of Object.entries(config.paths)) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      if (specifier === pattern) {
        for (const target of targets) {
          candidates.push(join(config.absoluteBaseUrl, target));
        }
      }
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!(specifier.startsWith(prefix) && specifier.endsWith(suffix))) {
      continue;
    }
    const captured = specifier.slice(
      prefix.length,
      specifier.length - suffix.length
    );
    for (const target of targets) {
      const mapped = target.replace("*", captured);
      candidates.push(join(config.absoluteBaseUrl, mapped));
    }
  }
  return candidates;
}

export function tryResolveFile(absoluteWithoutExt: string): string | null {
  const extensions = [
    "",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".mjs",
    ".cjs",
    ".vue",
    ".svelte",
    "/index.tsx",
    "/index.ts",
    "/index.jsx",
    "/index.js",
    "/index.vue",
    "/index.svelte",
  ];
  for (const ext of extensions) {
    const candidate = absoluteWithoutExt + ext;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function toProjectRelative(
  absolutePath: string,
  projectRoot: string
): string {
  return relative(projectRoot, absolutePath).split("\\").join("/");
}
