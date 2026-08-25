import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const NODE_MODULES_PACKAGE_RE = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/i;
const CASKROOM_VERSION_RE = /\/Caskroom\/[^/]+\/([^/]+)/i;
const CELLAR_VERSION_RE = /\/Cellar\/[^/]+\/([^/]+)/i;
const VERSIONS_DIR_RE = /\/(?:claude|cursor-agent)\/versions\/([^/]+)/i;

function resolvePath(binPath: string): string {
  try {
    return realpathSync(binPath);
  } catch {
    return binPath;
  }
}

function posixPath(binPath: string): string {
  return resolvePath(binPath).replace(/\\/g, "/");
}

function isUsableVersionSegment(segment: string): boolean {
  const s = segment.trim();
  if (s.length === 0 || s.startsWith(".")) {
    return false;
  }
  if (s.startsWith(".tmp-") || s === "bin" || s === "lib" || s === "share") {
    return false;
  }
  return true;
}

function versionFromBrewLayout(resolved: string): string | null {
  const cask = CASKROOM_VERSION_RE.exec(resolved);
  if (cask?.[1] && isUsableVersionSegment(cask[1])) {
    return cask[1];
  }
  const cellar = CELLAR_VERSION_RE.exec(resolved);
  if (cellar?.[1] && isUsableVersionSegment(cellar[1])) {
    return cellar[1];
  }
  return null;
}

function versionFromVersionsDirLayout(resolved: string): string | null {
  const match = VERSIONS_DIR_RE.exec(resolved);
  const segment = match?.[1];
  if (!(segment && isUsableVersionSegment(segment))) {
    return null;
  }
  return segment;
}

function versionFromNpmPackage(resolved: string): string | null {
  const match = NODE_MODULES_PACKAGE_RE.exec(resolved);
  if (!match || match.index === undefined || !match[0]) {
    return null;
  }
  const packageRoot = resolved.slice(0, match.index + match[0].length);
  const pkgPath = join(packageRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      const version = parsed.version.trim();
      return version.length > 0 ? version : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Current version from the install layout. Does not spawn the CLI.
 * Unknown layouts return null so `--version` can fill in.
 */
export function readCurrentVersionFromPath(binPath: string): string | null {
  const resolved = posixPath(binPath);
  return (
    versionFromBrewLayout(resolved) ??
    versionFromVersionsDirLayout(resolved) ??
    versionFromNpmPackage(resolved)
  );
}
