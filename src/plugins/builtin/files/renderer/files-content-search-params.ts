/**
 * Dockview panel params for pier.files.searchPanel.
 * Only query *conditions* are persisted — never the result set
 * (design 2026-07-27 §7 / files-core-stability task 9).
 */
import { z } from "zod";

const relativePosixDirSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => !v.includes("\0"), "path must not contain NUL")
  .refine((v) => !v.startsWith("/"), "path must be repo-relative")
  .refine((v) => !/(^|\/)\.\.(\/|$)/.test(v), "path must not contain '..'");

export const filesContentSearchPanelParamsSchema = z
  .object({
    /** Absolute project root. */
    root: z.string().min(1).optional(),
    query: z.string().max(1024).optional(),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    regexp: z.boolean().optional(),
    include: z.string().max(1024).optional(),
    applyGitIgnore: z.boolean().optional(),
    applyExcludePatterns: z.boolean().optional(),
    /**
     * Single root-relative directory scope.
     * `null` clears sticky folder scope on dockview param replace.
     * Invalid strings are dropped to undefined.
     */
    scopeDir: z
      .union([relativePosixDirSchema, z.null()])
      .optional()
      .catch(undefined),
    /**
     * Monotonic token from openSearchPanel so a live panel re-applies external
     * condition updates (Find in Folder / re-open command).
     */
    openGeneration: z.number().int().nonnegative().optional(),
  })
  .passthrough();

/** Wire/persisted panel params (scopeDir may be null to clear). */
export interface FilesContentSearchPanelParams {
  applyExcludePatterns?: boolean;
  applyGitIgnore?: boolean;
  caseSensitive?: boolean;
  include?: string;
  openGeneration?: number;
  query?: string;
  regexp?: boolean;
  root?: string;
  scopeDir?: string | null;
  wholeWord?: boolean;
  [key: string]: unknown;
}

export interface FilesContentSearchConditions {
  readonly applyExcludePatterns: boolean;
  readonly applyGitIgnore: boolean;
  readonly caseSensitive: boolean;
  readonly include: string;
  readonly query: string;
  readonly regexp: boolean;
  readonly root: string;
  readonly scopeDir: string | undefined;
  readonly wholeWord: boolean;
}

export const DEFAULT_CONTENT_SEARCH_CONDITIONS = {
  applyExcludePatterns: true,
  applyGitIgnore: true,
  caseSensitive: false,
  include: "",
  query: "",
  regexp: false,
  wholeWord: false,
} as const;

export function parseContentSearchPanelParams(
  params: unknown
): FilesContentSearchPanelParams {
  const parsed = filesContentSearchPanelParamsSchema.safeParse(params ?? {});
  if (!parsed.success) {
    return {};
  }
  const data = parsed.data;
  const result: FilesContentSearchPanelParams = {};
  if (data.root !== undefined) result.root = data.root;
  if (data.query !== undefined) result.query = data.query;
  if (data.caseSensitive !== undefined) {
    result.caseSensitive = data.caseSensitive;
  }
  if (data.wholeWord !== undefined) result.wholeWord = data.wholeWord;
  if (data.regexp !== undefined) result.regexp = data.regexp;
  if (data.include !== undefined) result.include = data.include;
  if (data.applyGitIgnore !== undefined) {
    result.applyGitIgnore = data.applyGitIgnore;
  }
  if (data.applyExcludePatterns !== undefined) {
    result.applyExcludePatterns = data.applyExcludePatterns;
  }
  if (data.openGeneration !== undefined) {
    result.openGeneration = data.openGeneration;
  }
  if (data.scopeDir === null) {
    result.scopeDir = null;
  } else if (typeof data.scopeDir === "string") {
    result.scopeDir = data.scopeDir;
  }
  return result;
}

export function conditionsFromPanelParams(
  params: unknown,
  fallbackRoot: string | null
): FilesContentSearchConditions | null {
  const p = parseContentSearchPanelParams(params);
  const root =
    typeof p.root === "string" && p.root.length > 0
      ? p.root
      : (fallbackRoot ?? null);
  if (!root) {
    return null;
  }
  return {
    applyExcludePatterns:
      p.applyExcludePatterns ??
      DEFAULT_CONTENT_SEARCH_CONDITIONS.applyExcludePatterns,
    applyGitIgnore:
      p.applyGitIgnore ?? DEFAULT_CONTENT_SEARCH_CONDITIONS.applyGitIgnore,
    caseSensitive:
      p.caseSensitive ?? DEFAULT_CONTENT_SEARCH_CONDITIONS.caseSensitive,
    include: p.include ?? DEFAULT_CONTENT_SEARCH_CONDITIONS.include,
    query: p.query ?? DEFAULT_CONTENT_SEARCH_CONDITIONS.query,
    regexp: p.regexp ?? DEFAULT_CONTENT_SEARCH_CONDITIONS.regexp,
    root,
    scopeDir: typeof p.scopeDir === "string" ? p.scopeDir : undefined,
    wholeWord: p.wholeWord ?? DEFAULT_CONTENT_SEARCH_CONDITIONS.wholeWord,
  };
}

export function conditionsToPanelParams(
  conditions: FilesContentSearchConditions
): FilesContentSearchPanelParams {
  // Persist scopeDir as null when cleared so dockview param replace cannot
  // leave a previous folder scope sticky (JSON omits undefined keys).
  return {
    applyExcludePatterns: conditions.applyExcludePatterns,
    applyGitIgnore: conditions.applyGitIgnore,
    caseSensitive: conditions.caseSensitive,
    include: conditions.include,
    query: conditions.query,
    regexp: conditions.regexp,
    root: conditions.root,
    scopeDir: conditions.scopeDir ?? null,
    wholeWord: conditions.wholeWord,
  };
}
