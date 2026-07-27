import { LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY } from "@shared/contracts/live-modules.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
  type LiveModuleFramework,
} from "@shared/live-module-framework.ts";

/** Live-module content roots under a project (relative to project root). */
export const LIVE_MODULE_PROJECT_CONTENT_DIRECTORIES = [
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
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
  /** Root-relative content directory, e.g. `.pier/canvases`. */
  directory: string;
  /** Path relative to `directory` for `liveModules.compile`. */
  relPath: string;
}

/**
 * Project-relative path is a Live Module canvas under a known project content
 * directory with a known framework suffix.
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

/** Project-relative directory holding a canvas (`""` when at a root). */
export function canvasDirectoryFromProjectPath(
  projectRelativePath: string
): string | null {
  if (!isProjectCanvasPath(projectRelativePath)) {
    return null;
  }
  const normalized = normalizeProjectRelativePath(projectRelativePath);
  const cut = normalized.lastIndexOf("/");
  return cut < 0 ? "" : normalized.slice(0, cut);
}

/**
 * Resolve `fileName` as a sibling of a canvas, or null when it is not one.
 *
 * A canvas may only address plain file names in its own directory: no path
 * separators, no `..`, no absolute or drive paths, no NUL, no dot entries. The
 * lexical check runs before any IPC; the file service still applies its own
 * realpath fence on the resulting project-relative path.
 */
export function canvasSiblingProjectPath(
  canvasProjectRelativePath: string,
  fileName: string
): string | null {
  const directory = canvasDirectoryFromProjectPath(canvasProjectRelativePath);
  if (directory === null) {
    return null;
  }
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("\0") ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /^[A-Za-z]:/u.test(fileName)
  ) {
    return null;
  }
  return directory.length > 0 ? `${directory}/${fileName}` : fileName;
}
