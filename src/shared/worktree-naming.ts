const BRANCH_LIKE_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SLUG_TOKEN_PATTERN = /[a-z0-9]+/g;
const MAX_SLUG_LENGTH = 24;
const SLASH_PATTERN = /\//g;
const INVALID_CHARS_PATTERN = /[^A-Za-z0-9._-]+/g;
const INVALID_BRANCH_CANDIDATE_CHARS_PATTERN = /[^A-Za-z0-9._/-]+/g;
const CONSECUTIVE_DASH_PATTERN = /-+/g;
const CONSECUTIVE_DOT_PATTERN = /\.{2,}/g;
const CONSECUTIVE_SLASH_PATTERN = /\/+/g;
const LEADING_INVALID_PATTERN = /^[-.]+/;
const TRAILING_INVALID_PATTERN = /[-.]+$/;
const BACKSLASH_PATTERN = /\\/g;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const CODENAME_ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "clever",
  "coral",
  "eager",
  "gentle",
  "keen",
  "lucid",
  "mellow",
  "nimble",
  "quiet",
  "sunny",
  "swift",
  "tidal",
  "vivid",
] as const;

const CODENAME_NOUNS = [
  "anchor",
  "beacon",
  "breeze",
  "buoy",
  "cove",
  "current",
  "harbor",
  "jetty",
  "keel",
  "lagoon",
  "marina",
  "mast",
  "pier",
  "quay",
  "sail",
  "tide",
] as const;

export type WorktreeNameSource =
  | "branch"
  | "codename"
  | "description"
  | "existing-branch";

export interface WorktreeCreationDraft {
  branch: string;
  name: string;
  source: WorktreeNameSource;
}

export interface DeriveWorktreeCreationArgs {
  existingBranches: readonly string[];
  existingNames: readonly string[];
  input: string;
  random?: () => number;
}

export function sanitizeWorktreeName(value: string): string {
  return value
    .replace(SLASH_PATTERN, "-")
    .replace(INVALID_CHARS_PATTERN, "-")
    .replace(CONSECUTIVE_DASH_PATTERN, "-")
    .replace(LEADING_INVALID_PATTERN, "")
    .replace(TRAILING_INVALID_PATTERN, "");
}

function sanitizeBranchSegment(value: string): string {
  const withoutInvalidDots = value.replace(CONSECUTIVE_DOT_PATTERN, "-");
  const withoutLockSuffix = withoutInvalidDots.endsWith(".lock")
    ? `${withoutInvalidDots.slice(0, -5)}-lock`
    : withoutInvalidDots;
  return sanitizeWorktreeName(withoutLockSuffix);
}

export function sanitizeBranchCandidate(value: string): string {
  return value
    .trim()
    .replace(BACKSLASH_PATTERN, "/")
    .replace(INVALID_BRANCH_CANDIDATE_CHARS_PATTERN, "-")
    .replace(CONSECUTIVE_DASH_PATTERN, "-")
    .replace(CONSECUTIVE_SLASH_PATTERN, "/")
    .split("/")
    .map(sanitizeBranchSegment)
    .filter((segment) => segment.length > 0)
    .join("/");
}

const INVALID_GIT_REF_CHARACTERS = new Set([
  "~",
  "^",
  ":",
  "?",
  "*",
  "[",
  "\\",
]);

/**
 * 覆盖 `git check-ref-format --branch` 核心规则的纯函数守卫。
 * main 侧仍以 Git 本身为最终权威，这里用于在进入后台创建前拦截/修复输入。
 */
export function isValidGitBranchName(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{")
  ) {
    return false;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code <= 0x20 ||
      code === 0x7f ||
      INVALID_GIT_REF_CHARACTERS.has(character)
    ) {
      return false;
    }
  }
  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        !segment.startsWith(".") &&
        !segment.endsWith(".lock")
    );
}

export function slugifyDescription(input: string): string | null {
  const tokens = (input.toLowerCase().match(SLUG_TOKEN_PATTERN) ?? []).filter(
    (token) => !STOP_WORDS.has(token)
  );
  const first = tokens[0];
  if (!first) {
    return null;
  }
  let slug = "";
  for (const token of tokens) {
    const next = slug ? `${slug}-${token}` : token;
    if (next.length > MAX_SLUG_LENGTH) {
      break;
    }
    slug = next;
  }
  return slug || first.slice(0, MAX_SLUG_LENGTH);
}

function pickWord(words: readonly string[], random: () => number): string {
  const index = Math.min(words.length - 1, Math.floor(random() * words.length));
  return words[index] ?? "pier";
}

function codename(random: () => number): string {
  return `${pickWord(CODENAME_ADJECTIVES, random)}-${pickWord(CODENAME_NOUNS, random)}`;
}

function dedupe(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(base)) {
    return base;
  }
  let suffix = 2;
  while (taken(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function draftFrom(
  branchBase: string,
  source: WorktreeNameSource,
  args: DeriveWorktreeCreationArgs
): WorktreeCreationDraft {
  const branchSet = new Set(args.existingBranches);
  const nameSet = new Set(args.existingNames);
  const branch =
    source === "existing-branch"
      ? branchBase
      : dedupe(branchBase, (candidate) => branchSet.has(candidate));
  const nameBase = sanitizeWorktreeName(branch) || "worktree";
  const name = dedupe(nameBase, (candidate) => nameSet.has(candidate));
  return { branch, name, source };
}

export interface DeriveFromSlugArgs {
  existingBranches: readonly string[];
  existingNames: readonly string[];
}

/**
 * 用 AI 生成的英文 slug 派生 branch/name(规整 + 去重)。
 * slug 规整后为空(如全非法字符)时返回 null,调用方自行降级。
 */
export function deriveWorktreeCreationFromSlug(
  slug: string,
  args: DeriveFromSlugArgs
): WorktreeCreationDraft | null {
  const cleaned = sanitizeBranchCandidate(slug.toLowerCase());
  if (!cleaned) {
    return null;
  }
  return draftFrom(cleaned, "description", {
    ...args,
    input: slug,
  });
}

export function deriveWorktreeCreation(
  args: DeriveWorktreeCreationArgs
): WorktreeCreationDraft {
  const input = args.input.trim();
  const random = args.random ?? Math.random;

  if (input.length === 0) {
    return draftFrom(codename(random), "codename", args);
  }
  if (args.existingBranches.includes(input)) {
    return draftFrom(input, "existing-branch", args);
  }
  if (BRANCH_LIKE_PATTERN.test(input)) {
    return draftFrom(input, "branch", args);
  }
  const slug = slugifyDescription(input);
  if (!slug) {
    return draftFrom(codename(random), "codename", args);
  }
  return draftFrom(slug, "description", args);
}
