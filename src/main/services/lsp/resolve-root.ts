import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function normalizeFsRoot(rootPath: string): string {
  return rootPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

/**
 * Walk from file dirname toward filesystem root; return first directory that
 * contains any of the marker files. Falls back to fallbackWorkspaceRoot.
 */
export function resolveRootByMarkers(input: {
  fallbackWorkspaceRoot: string;
  filePath: string;
  markers: readonly string[];
}): string {
  const fallback = normalizeFsRoot(input.fallbackWorkspaceRoot);
  let dir = dirname(input.filePath.replace(/\\/g, "/"));
  if (!dir || dir === ".") {
    return fallback;
  }

  const stopAt = fallback;
  for (let i = 0; i < 64; i += 1) {
    for (const marker of input.markers) {
      if (existsSync(join(dir, marker))) {
        return normalizeFsRoot(dir);
      }
    }
    if (normalizeFsRoot(dir) === stopAt) {
      break;
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) {
      break;
    }
    dir = parent;
  }
  return fallback;
}

export function extensionOfPath(path: string): string {
  const base = path.replace(/\\/g, "/");
  const slash = base.lastIndexOf("/");
  const name = slash >= 0 ? base.slice(slash + 1) : base;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot).toLowerCase();
}

export function matchPathExtensions(
  path: string,
  extensions: readonly string[]
): boolean {
  const ext = extensionOfPath(path);
  if (!ext) {
    return false;
  }
  return extensions.includes(ext);
}
