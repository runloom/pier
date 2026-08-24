import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { Minimatch } from "minimatch";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "../../settings.ts";
import {
  EMPTY_GIT_IGNORED_INDEX,
  FilesTreeGitIgnoredIndex,
  type GitIgnoredIndex,
  isGitIgnoredPath,
} from "./git-ignored-index.ts";

export interface FilesTreeList {
  isPathVisible?: (root: string, path: string) => boolean;
  (root: string, options?: { path?: string }): Promise<FileEntry[]>;
}

const controllersByContext = new WeakMap<
  RendererPluginContext,
  FilesTreeVisibilityController
>();
let cachedExcludePatternSource = "";
let cachedExcludeMatchers: readonly Minimatch[] = [];

export function parseFilesTreeExcludePatterns(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function compileFilesTreeExcludePatterns(source: string): readonly Minimatch[] {
  if (source === cachedExcludePatternSource) {
    return cachedExcludeMatchers;
  }
  cachedExcludePatternSource = source;
  cachedExcludeMatchers = parseFilesTreeExcludePatterns(source).map(
    (pattern) =>
      new Minimatch(pattern, {
        dot: true,
        nonegate: true,
      })
  );
  return cachedExcludeMatchers;
}

function normalizeFileTreePath(path: string): string {
  return path
    .replace(/^\.\//, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

export function isExcludedFileTreePath(
  path: string,
  patternSource: string
): boolean {
  const matchers = compileFilesTreeExcludePatterns(patternSource);
  let candidate = normalizeFileTreePath(path).replace(/\/+$/, "");
  while (candidate) {
    if (matchers.some((matcher) => matcher.match(candidate))) {
      return true;
    }
    const slash = candidate.lastIndexOf("/");
    candidate = slash < 0 ? "" : candidate.slice(0, slash);
  }
  return false;
}

export function isDefaultExcludedFileTreePath(path: string): boolean {
  return isExcludedFileTreePath(path, FILES_TREE_DEFAULT_EXCLUDE_PATTERNS);
}

const EMPTY_PINNED_PATHS: ReadonlySet<string> = new Set();

/** True when `path` is a pinned path itself or an ancestor directory of one. */
export function isVisibleForPinnedPaths(
  path: string,
  pinnedPaths: ReadonlySet<string>
): boolean {
  if (pinnedPaths.size === 0) {
    return false;
  }
  const candidate = normalizeFileTreePath(path).replace(/\/+$/, "");
  for (const pinned of pinnedPaths) {
    if (pinned === candidate || pinned.startsWith(`${candidate}/`)) {
      return true;
    }
  }
  return false;
}

export function filterFilesTreeEntries(
  entries: readonly FileEntry[],
  options: {
    excludePatterns: string;
    gitIgnored?: GitIgnoredIndex;
    /** Pinned paths stay visible (with ancestors) even when Git-ignored. */
    pinnedVisiblePaths?: ReadonlySet<string>;
    showExcludedFiles: boolean;
    showGitIgnoredFiles: boolean;
  }
): FileEntry[] {
  return entries.filter((entry) => {
    if (
      !options.showExcludedFiles &&
      isExcludedFileTreePath(entry.path, options.excludePatterns)
    ) {
      // User exclusion patterns are explicit config; pins never override them.
      return false;
    }
    if (
      options.showGitIgnoredFiles ||
      !options.gitIgnored ||
      !isGitIgnoredPath(entry.path, options.gitIgnored)
    ) {
      return true;
    }
    return options.pinnedVisiblePaths
      ? isVisibleForPinnedPaths(entry.path, options.pinnedVisiblePaths)
      : false;
  });
}

function configurationBoolean(
  context: RendererPluginContext,
  key: string,
  fallback: boolean
): boolean {
  const value = context.configuration?.get?.<unknown>(key);
  return typeof value === "boolean" ? value : fallback;
}

function configurationString(
  context: RendererPluginContext,
  key: string,
  fallback: string
): string {
  const value = context.configuration?.get?.<unknown>(key);
  return typeof value === "string" ? value : fallback;
}

export class FilesTreeVisibilityController {
  readonly #context: RendererPluginContext;
  readonly #gitIgnored: FilesTreeGitIgnoredIndex;
  /** Per-root paths forced visible (active/opened Git-ignored files). */
  readonly #pinnedPathsByRoot = new Map<string, Set<string>>();
  readonly list: FilesTreeList;

  constructor(context: RendererPluginContext) {
    this.#context = context;
    this.#gitIgnored = new FilesTreeGitIgnoredIndex(context);
    this.list = Object.assign(
      async (root: string, options?: { path?: string }) => {
        const showGitIgnoredFiles = this.showsGitIgnoredFiles();
        const [entries, gitIgnored] = await Promise.all([
          this.#context.files.list(root, options),
          showGitIgnoredFiles
            ? Promise.resolve(EMPTY_GIT_IGNORED_INDEX)
            : this.#gitIgnored.load(root),
        ]);
        return filterFilesTreeEntries(entries, {
          excludePatterns: this.excludePatterns(),
          gitIgnored,
          pinnedVisiblePaths: this.pinnedVisiblePaths(root),
          showExcludedFiles: this.showsExcludedFiles(),
          showGitIgnoredFiles,
        });
      },
      {
        isPathVisible: (root: string, path: string) =>
          this.isPathVisible(root, path),
      }
    );
  }

  excludePatterns(): string {
    return configurationString(
      this.#context,
      FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
      FILES_TREE_DEFAULT_EXCLUDE_PATTERNS
    );
  }

  invalidateGitIgnored(root: string): void {
    this.#gitIgnored.invalidate(root);
  }

  /** Pin a path visible (with its ancestor chain) even when Git-ignored.
   *  Returns true when the pin is new and the tree needs a reload. */
  pinPath(root: string, path: string): boolean {
    const normalized = normalizeFileTreePath(path).replace(/\/+$/, "");
    if (!normalized) {
      return false;
    }
    let pinned = this.#pinnedPathsByRoot.get(root);
    if (!pinned) {
      pinned = new Set();
      this.#pinnedPathsByRoot.set(root, pinned);
    }
    if (pinned.has(normalized)) {
      return false;
    }
    pinned.add(normalized);
    return true;
  }

  /** Release a pin; returns true when visibility changed for `root`. */
  unpinPath(root: string, path: string): boolean {
    const pinned = this.#pinnedPathsByRoot.get(root);
    if (!pinned?.delete(normalizeFileTreePath(path).replace(/\/+$/, ""))) {
      return false;
    }
    if (pinned.size === 0) {
      this.#pinnedPathsByRoot.delete(root);
    }
    return true;
  }

  pinnedVisiblePaths(root: string): ReadonlySet<string> {
    return this.#pinnedPathsByRoot.get(root) ?? EMPTY_PINNED_PATHS;
  }

  /**
   * True when `path` would be hidden right now (Git-ignore hiding on and
   * path ignored). Resolves the ignore index first so callers can decide
   * whether a pin/unpin actually changes visible tree content.
   */
  async isPathHiddenByGitIgnore(root: string, path: string): Promise<boolean> {
    if (this.showsGitIgnoredFiles()) {
      return false;
    }
    const gitIgnored = await this.#gitIgnored.load(root);
    return isGitIgnoredPath(path, gitIgnored);
  }

  isPathVisible(root: string, path: string): boolean {
    if (
      !this.showsExcludedFiles() &&
      isExcludedFileTreePath(path, this.excludePatterns())
    ) {
      return false;
    }
    if (this.showsGitIgnoredFiles()) {
      return true;
    }
    const gitIgnored = this.#gitIgnored.current(root);
    if (!(gitIgnored && isGitIgnoredPath(path, gitIgnored))) {
      return true;
    }
    // Pinned (opened) ignored files stay visible; see filterFilesTreeEntries.
    return isVisibleForPinnedPaths(path, this.pinnedVisiblePaths(root));
  }

  async refreshGitIgnored(
    root: string
  ): Promise<{ changed: boolean; entries: readonly string[] }> {
    return await this.#gitIgnored.refresh(root);
  }

  showsExcludedFiles(): boolean {
    return configurationBoolean(
      this.#context,
      FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
      false
    );
  }

  showsGitIgnoredFiles(): boolean {
    // Default hidden: ignored entries stay openable — opening one pins its
    // directory chain visible in the tree until another file becomes active.
    return configurationBoolean(
      this.#context,
      FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
      false
    );
  }
}

export function filesTreeVisibilityForContext(
  context: RendererPluginContext
): FilesTreeVisibilityController {
  const existing = controllersByContext.get(context);
  if (existing) {
    return existing;
  }
  const controller = new FilesTreeVisibilityController(context);
  controllersByContext.set(context, controller);
  return controller;
}
