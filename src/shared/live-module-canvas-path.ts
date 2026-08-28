import {
  LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  liveModulesProjectConfigSchema,
} from "@shared/contracts/live-modules.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
  type LiveModuleFramework,
} from "@shared/live-module-framework.ts";

/**
 * Factory defaults for canvas preview roots.
 * Prefer {@link liveModuleProjectContentDirectories} for the effective list.
 */
export const LIVE_MODULE_PROJECT_CONTENT_DIRECTORIES =
  LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES;

/** Max content roots (matches liveModulesProjectConfigSchema). */
export const LIVE_MODULE_MAX_CONTENT_DIRECTORIES = 32;

/** @deprecated Use isLiveModuleCanvasFileName — kept for call-site clarity. */
export const LIVE_MODULE_CANVAS_SUFFIX = ".canvas.tsx";

/** Normalize to forward-slash relative paths for comparisons. */
export function normalizeProjectRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** Stable map key for a project root path. */
export function normalizeProjectRootKey(projectRootPath: string): string {
  return projectRootPath.replaceAll("\\", "/").replace(/\/+$/u, "");
}

/**
 * Normalize a project-relative content directory segment.
 * Returns null when empty, absolute, or contains `..`.
 */
export function normalizeContentDirectory(directory: string): string | null {
  const normalized = normalizeProjectRelativePath(directory).replace(
    /\/+$/u,
    ""
  );
  // Reject empty, ".", absolute, NUL, and ".." segments. "." never matches
  // project-relative canvas paths after leading "./" stripping.
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

/** Dedupe and normalize a directory list (preserves first-seen order). */
export function normalizeContentDirectoryList(
  directories: readonly string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const directory of directories) {
    const normalized = normalizeContentDirectory(directory);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

/**
 * @deprecated Prefer {@link normalizeContentDirectoryList} for full lists,
 * or {@link resolveLiveModuleContentDirectories} for config resolution.
 * Still merges factory defaults with extras (legacy migration helper).
 */
export function mergeLiveModuleContentDirectories(
  extras: readonly string[] = []
): string[] {
  return normalizeContentDirectoryList([
    ...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
    ...extras,
  ]);
}

/**
 * Resolve the effective content-directory list from a parsed config object.
 * - `contentDirectories` (non-empty after normalize) wins as the full list
 * - else legacy `extraContentDirectories` → defaults ∪ extras
 * - else factory defaults
 */
export function resolveLiveModuleContentDirectories(input: {
  contentDirectories?: readonly string[] | undefined;
  extraContentDirectories?: readonly string[] | undefined;
}): string[] {
  if (input.contentDirectories && input.contentDirectories.length > 0) {
    const full = normalizeContentDirectoryList(input.contentDirectories);
    if (full.length > 0) {
      return full;
    }
  }
  if (
    input.extraContentDirectories &&
    input.extraContentDirectories.length > 0
  ) {
    return normalizeContentDirectoryList([
      ...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
      ...input.extraContentDirectories,
    ]);
  }
  return [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES];
}

/**
 * Per-project runtime content-root lists (null entry = factory defaults).
 * Keyed by {@link normalizeProjectRootKey}.
 */
const runtimeContentDirectoriesByProject = new Map<string, string[]>();

/**
 * Replace the effective content roots for one project.
 * Pass `null` to clear that project (reverts to factory defaults).
 */
export function setRuntimeLiveModuleContentDirectories(
  projectRootPath: string,
  directories: readonly string[] | null
): void {
  const key = normalizeProjectRootKey(projectRootPath);
  if (directories === null) {
    runtimeContentDirectoriesByProject.delete(key);
    return;
  }
  const normalized = normalizeContentDirectoryList(directories);
  runtimeContentDirectoriesByProject.set(
    key,
    normalized.length > 0
      ? normalized
      : [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES]
  );
}

/** @deprecated Use {@link setRuntimeLiveModuleContentDirectories}. */
export function setRuntimeLiveModuleExtraContentDirectories(
  projectRootPath: string,
  extras: readonly string[]
): void {
  if (extras.length === 0) {
    setRuntimeLiveModuleContentDirectories(projectRootPath, null);
    return;
  }
  setRuntimeLiveModuleContentDirectories(
    projectRootPath,
    resolveLiveModuleContentDirectories({ extraContentDirectories: extras })
  );
}

export function getRuntimeLiveModuleContentDirectories(
  projectRootPath: string
): readonly string[] | null {
  return (
    runtimeContentDirectoriesByProject.get(
      normalizeProjectRootKey(projectRootPath)
    ) ?? null
  );
}

/**
 * Effective content roots for preview/path checks for one project.
 * Without a project root, returns factory defaults only.
 */
export function liveModuleProjectContentDirectories(
  projectRootPath?: string
): readonly string[] {
  if (!projectRootPath) {
    return [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES];
  }
  return (
    runtimeContentDirectoriesByProject.get(
      normalizeProjectRootKey(projectRootPath)
    ) ?? [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES]
  );
}

/** Clear all per-project runtime lists (tests / full reset). */
export function clearAllRuntimeLiveModuleContentDirectories(): void {
  runtimeContentDirectoriesByProject.clear();
}

/**
 * Parse `.pier/live-modules.json` body into an effective directory list.
 */
export function parseLiveModulesProjectConfig(raw: string): {
  contentDirectories: string[];
  /** True when config explicitly set the full list (not factory fallback only). */
  hasExplicitList: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = liveModulesProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      return {
        contentDirectories: [
          ...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
        ],
        hasExplicitList: false,
      };
    }
    const data = result.data;
    const hasFull =
      Array.isArray(data.contentDirectories) &&
      data.contentDirectories.length > 0;
    const hasLegacy =
      Array.isArray(data.extraContentDirectories) &&
      data.extraContentDirectories.length > 0;
    return {
      contentDirectories: resolveLiveModuleContentDirectories({
        contentDirectories: data.contentDirectories,
        extraContentDirectories: data.extraContentDirectories,
      }),
      hasExplicitList: hasFull || hasLegacy,
    };
  } catch {
    return {
      contentDirectories: [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES],
      hasExplicitList: false,
    };
  }
}

export {
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  LIVE_MODULES_PROJECT_CONFIG_PATH,
} from "@shared/contracts/live-modules.ts";

/**
 * Sanitize a content-directory string into a liveRootSpecSchema-safe id segment
 * (`/^[a-z][a-z0-9._-]*$/` when non-empty). Not unique alone — pair with
 * {@link contentDirectoryIdHash} in {@link liveModuleContentRootId}.
 */
export function sanitizeLiveRootIdSegment(directory: string): string {
  let segment = directory
    .replace(/^\./u, "")
    .toLowerCase()
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/[-._]{2,}/gu, (match) => match[0] ?? "-")
    .replace(/^[^a-z]+/gu, "")
    .replace(/[-._]+$/gu, "");
  if (!segment) {
    segment = "dir";
  }
  if (!/^[a-z]/u.test(segment)) {
    segment = `d-${segment}`;
  }
  return segment.slice(0, 80);
}

/** Short stable hash for content-directory identity (charset a-z0-9). */
export function contentDirectoryIdHash(directory: string): string {
  const normalized = directory.replaceAll("\\", "/").toLowerCase();
  let h = 0x81_1c_9d_c5;
  for (let index = 0; index < normalized.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash needs xor/unsigned shift
    h = Math.imul(h ^ normalized.charCodeAt(index), 0x01_00_01_93) >>> 0;
  }
  return h.toString(36);
}

/**
 * Live root id for a project content directory.
 * The factory default write root keeps the bare `baseRootId` (no suffix).
 * Other directories get a human segment + hash so `foo/bar` ≠ `foo-bar`.
 */
export function liveModuleContentRootId(
  baseRootId: string,
  contentDirectory: string,
  defaultDirectory: string = LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY
): string {
  const normalized =
    normalizeContentDirectory(contentDirectory) ?? contentDirectory;
  if (normalized.toLowerCase() === defaultDirectory.toLowerCase()) {
    return baseRootId;
  }
  const segment = sanitizeLiveRootIdSegment(normalized);
  const hash = contentDirectoryIdHash(normalized);
  return `${baseRootId}.${segment}.${hash}`;
}

export function isCanvasFileName(fileName: string): boolean {
  return isLiveModuleCanvasFileName(fileName);
}

export interface ProjectCanvasLocation {
  /** Root-relative content directory, e.g. `.pier/canvases` or `docs`. */
  directory: string;
  /** Path relative to `directory` for `liveModules.compile`. */
  relPath: string;
}

/**
 * Project-relative path is a Live Module canvas under a known project content
 * directory with a known framework suffix.
 *
 * Pass `contentDirectories` (or the result of
 * {@link liveModuleProjectContentDirectories} for a project root) when the
 * project has a custom list; otherwise factory defaults are used.
 */
export function isProjectCanvasPath(
  projectRelativePath: string,
  contentDirectories?: readonly string[]
): boolean {
  return (
    projectCanvasLocation(projectRelativePath, contentDirectories) !== null
  );
}

export function detectProjectCanvasFramework(
  projectRelativePath: string,
  contentDirectories?: readonly string[]
): LiveModuleFramework | null {
  const location = projectCanvasLocation(
    projectRelativePath,
    contentDirectories
  );
  if (!location) {
    return null;
  }
  return detectLiveModuleFrameworkFromFileName(location.relPath);
}

/**
 * If `path` is a project canvas, return content directory + compile relPath.
 * Uses longest matching content root among the provided list (or factory
 * defaults when omitted).
 */
export function projectCanvasLocation(
  projectRelativePath: string,
  contentDirectories: readonly string[] = LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES
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
  const roots = normalizeContentDirectoryList(contentDirectories).sort(
    (a, b) => b.length - a.length
  );

  for (const directory of roots) {
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
  projectRelativePath: string,
  contentDirectories?: readonly string[]
): string | null {
  return (
    projectCanvasLocation(projectRelativePath, contentDirectories)?.relPath ??
    null
  );
}

export function canvasBasename(relPath: string): string {
  const segments = relPath.split("/").filter(Boolean);
  return segments.at(-1) ?? relPath;
}

/** Project-relative directory holding a canvas (`""` when at a content root file). */
export function canvasDirectoryFromProjectPath(
  projectRelativePath: string,
  contentDirectories?: readonly string[]
): string | null {
  if (!isProjectCanvasPath(projectRelativePath, contentDirectories)) {
    return null;
  }
  const normalized = normalizeProjectRelativePath(projectRelativePath);
  const cut = normalized.lastIndexOf("/");
  return cut < 0 ? "" : normalized.slice(0, cut);
}

const CANVAS_SCOPED_FILE_NAME_MAX = 255;

/**
 * A canvas may address a file in its own directory, or one nested folder
 * (`state/positions.json`). Reject `..`, absolute/drive paths, NUL, extra
 * depth, and empty segments. Lexical only; the file service still realpath-fences.
 */
export function isCanvasScopedFileName(fileName: string): boolean {
  if (
    fileName.length === 0 ||
    fileName.length > CANVAS_SCOPED_FILE_NAME_MAX ||
    fileName.includes("\0") ||
    fileName.includes("\\") ||
    /^[A-Za-z]:/u.test(fileName)
  ) {
    return false;
  }
  const segments = fileName.split("/");
  if (segments.length < 1 || segments.length > 2) {
    return false;
  }
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}

/**
 * Resolve `fileName` as a file next to a canvas (or one folder down), or null.
 */
export function canvasSiblingProjectPath(
  canvasProjectRelativePath: string,
  fileName: string,
  contentDirectories?: readonly string[]
): string | null {
  const directory = canvasDirectoryFromProjectPath(
    canvasProjectRelativePath,
    contentDirectories
  );
  if (directory === null || !isCanvasScopedFileName(fileName)) {
    return null;
  }
  return directory.length > 0 ? `${directory}/${fileName}` : fileName;
}
