import {
  LIVE_MODULE_DEFAULT_PLANS_DIRECTORY,
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
} from "@shared/contracts/live-modules.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
  type LiveModuleFramework,
} from "@shared/live-module-framework.ts";

/** Live-module content roots under a project (relative to project root). */
export const LIVE_MODULE_PROJECT_CONTENT_DIRECTORIES = [
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  LIVE_MODULE_DEFAULT_PLANS_DIRECTORY,
] as const;

/** @deprecated Use isLiveModuleCanvasFileName — kept for call-site clarity. */
export const LIVE_MODULE_CANVAS_SUFFIX = ".canvas.tsx";

/** Normalize to forward-slash relative paths for comparisons. */
export function normalizeProjectRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isCanvasFileName(fileName: string): boolean {
  return isLiveModuleCanvasFileName(fileName);
}

export interface ProjectCanvasLocation {
  /** Root-relative content directory, e.g. `.pier/canvases` or `.pier/plans`. */
  directory: string;
  /** Path relative to `directory` for `liveModules.compile`. */
  relPath: string;
}

/**
 * Project-relative path is a Live Module canvas under a known project content
 * directory (canvases or plans) with a known framework suffix.
 */
export function isProjectCanvasPath(projectRelativePath: string): boolean {
  return projectCanvasLocation(projectRelativePath) !== null;
}

export function detectProjectCanvasFramework(
  projectRelativePath: string
): LiveModuleFramework | null {
  const location = projectCanvasLocation(projectRelativePath);
  if (!location) {
    return null;
  }
  return detectLiveModuleFrameworkFromFileName(location.relPath);
}

/**
 * If `path` is a project canvas, return content directory + compile relPath.
 */
export function projectCanvasLocation(
  projectRelativePath: string
): ProjectCanvasLocation | null {
  const normalized = normalizeProjectRelativePath(projectRelativePath);
  if (normalized.length === 0) {
    return null;
  }

  const baseName = normalized.split("/").at(-1) ?? "";
  if (!isLiveModuleCanvasFileName(baseName)) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  for (const directory of LIVE_MODULE_PROJECT_CONTENT_DIRECTORIES) {
    const prefix = `${directory}/`.toLowerCase();
    if (!lowered.startsWith(prefix)) {
      continue;
    }
    const relPath = normalized.slice(directory.length + 1);
    if (
      relPath.length === 0 ||
      relPath.includes("\0") ||
      relPath.split("/").some((part) => part === "..")
    ) {
      return null;
    }
    return { directory, relPath };
  }
  return null;
}

/**
 * If `path` is a project canvas under a known root, return the path relative
 * to that content directory (for `compile`). Prefer
 * {@link projectCanvasLocation} when the content directory is needed.
 */
export function canvasRelPathFromProjectPath(
  projectRelativePath: string
): string | null {
  return projectCanvasLocation(projectRelativePath)?.relPath ?? null;
}

export function canvasBasename(relPath: string): string {
  const segments = relPath.split("/").filter(Boolean);
  return segments.at(-1) ?? relPath;
}
