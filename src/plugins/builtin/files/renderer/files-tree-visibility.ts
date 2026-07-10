import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { Minimatch } from "minimatch";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "../settings.ts";
import {
  EMPTY_GIT_IGNORED_INDEX,
  FilesTreeGitIgnoredIndex,
  type GitIgnoredIndex,
  isGitIgnoredPath,
} from "./files-tree-git-ignored-index.ts";

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

export function filterFilesTreeEntries(
  entries: readonly FileEntry[],
  options: {
    excludePatterns: string;
    gitIgnored?: GitIgnoredIndex;
    showExcludedFiles: boolean;
    showGitIgnoredFiles: boolean;
  }
): FileEntry[] {
  return entries.filter((entry) => {
    if (
      !options.showExcludedFiles &&
      isExcludedFileTreePath(entry.path, options.excludePatterns)
    ) {
      return false;
    }
    return !(
      !options.showGitIgnoredFiles &&
      options.gitIgnored &&
      isGitIgnoredPath(entry.path, options.gitIgnored)
    );
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

  isPathVisible(root: string, path: string): boolean {
    if (
      !this.showsExcludedFiles() &&
      isExcludedFileTreePath(path, this.excludePatterns())
    ) {
      return false;
    }
    const gitIgnored = this.#gitIgnored.current(root);
    return !(
      !this.showsGitIgnoredFiles() &&
      gitIgnored &&
      isGitIgnoredPath(path, gitIgnored)
    );
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
    return configurationBoolean(
      this.#context,
      FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
      true
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
