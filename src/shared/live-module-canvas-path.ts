import { LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY } from "@shared/contracts/live-modules.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
  type LiveModuleFramework,
} from "@shared/live-module-framework.ts";

const CANVAS_DIRECTORY_PREFIX = `${LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY}/`;

/** @deprecated Use isLiveModuleCanvasFileName — kept for call-site clarity. */
export const LIVE_MODULE_CANVAS_SUFFIX = ".canvas.tsx";

/** Normalize to forward-slash relative paths for comparisons. */
export function normalizeProjectRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isCanvasFileName(fileName: string): boolean {
  return isLiveModuleCanvasFileName(fileName);
}

/**
 * Project-relative path is a Live Module canvas entry under `.pier/canvases/`
 * with a known framework suffix (react/vue/solid/svelte).
 */
export function isProjectCanvasPath(projectRelativePath: string): boolean {
  return canvasRelPathFromProjectPath(projectRelativePath) !== null;
}

export function detectProjectCanvasFramework(
  projectRelativePath: string
): LiveModuleFramework | null {
  const rel = canvasRelPathFromProjectPath(projectRelativePath);
  if (!rel) {
    return null;
  }
  return detectLiveModuleFrameworkFromFileName(rel);
}

/**
 * If `path` is a project canvas under `.pier/canvases/`, return the path
 * relative to that directory (for `compile`).
 */
export function canvasRelPathFromProjectPath(
  projectRelativePath: string
): string | null {
  const normalized = normalizeProjectRelativePath(projectRelativePath);
  if (normalized.length === 0) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  const prefix = CANVAS_DIRECTORY_PREFIX.toLowerCase();
  if (!lowered.startsWith(prefix)) {
    return null;
  }

  const baseName = normalized.split("/").at(-1) ?? "";
  if (!isLiveModuleCanvasFileName(baseName)) {
    return null;
  }

  const relPath = normalized.slice(CANVAS_DIRECTORY_PREFIX.length);
  if (
    relPath.length === 0 ||
    relPath.includes("\0") ||
    relPath.split("/").some((part) => part === "..")
  ) {
    return null;
  }
  return relPath;
}

export function canvasBasename(relPath: string): string {
  const segments = relPath.split("/").filter(Boolean);
  return segments.at(-1) ?? relPath;
}
