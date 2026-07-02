const BRANCH_LIKE_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SLUG_TOKEN_PATTERN = /[a-z0-9]+/g;
const MAX_SLUG_LENGTH = 24;
const SLASH_PATTERN = /\//g;
const INVALID_CHARS_PATTERN = /[^A-Za-z0-9._-]+/g;
const CONSECUTIVE_DASH_PATTERN = /-+/g;
const LEADING_INVALID_PATTERN = /^[-.]+/;
const TRAILING_INVALID_PATTERN = /[-.]+$/;

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
  branchPrefix: string;
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
  const prefixName = sanitizeWorktreeName(args.branchPrefix);
  const stripped =
    prefixName && nameBase.startsWith(`${prefixName}-`)
      ? nameBase.slice(prefixName.length + 1)
      : nameBase;
  const name = dedupe(stripped || "worktree", (candidate) =>
    nameSet.has(candidate)
  );
  return { branch, name, source };
}

export function deriveWorktreeCreation(
  args: DeriveWorktreeCreationArgs
): WorktreeCreationDraft {
  const input = args.input.trim();
  const random = args.random ?? Math.random;

  if (input.length === 0) {
    return draftFrom(
      `${args.branchPrefix}${codename(random)}`,
      "codename",
      args
    );
  }
  if (args.existingBranches.includes(input)) {
    return draftFrom(input, "existing-branch", args);
  }
  if (BRANCH_LIKE_PATTERN.test(input)) {
    return draftFrom(input, "branch", args);
  }
  const slug = slugifyDescription(input);
  if (!slug) {
    return draftFrom(
      `${args.branchPrefix}${codename(random)}`,
      "codename",
      args
    );
  }
  return draftFrom(`${args.branchPrefix}${slug}`, "description", args);
}
