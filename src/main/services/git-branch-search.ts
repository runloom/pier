import type {
  GitDiffBranchesResult,
  GitDiffBranchOption,
} from "../../shared/contracts/git.ts";
import { validateGitCwd } from "./git-cwd.ts";
import { GitExecError } from "./git-exec.ts";

const BRANCH_FIELD_SEPARATOR = "\x1f";
const BRANCH_RECORD_SEPARATOR = "\x1e";
const DEFAULT_BRANCH_LIMIT = 20;
// 命令面板本地过滤需要全量候选,上限只作为 IPC payload 安全阀。
const MAX_BRANCH_LIMIT = 1000;
const ORIGIN_HEAD_RE = /^refs\/remotes\/[^/]+\/(.+)$/;
const REMOTE_HEAD_RE = /\/HEAD$/;
const TIMEOUT_RE = /timeout|timed out|超时/i;
const TRACK_AHEAD_RE = /\bahead ([0-9]+)\b/;
const TRACK_BEHIND_RE = /\bbehind ([0-9]+)\b/;

export type GitBranchSearchExec = (
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<string>;

export interface GitBranchSearchOptions {
  currentBranch?: null | string | undefined;
  limit?: number | undefined;
  query?: string | undefined;
}

function durationSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function errorMessage(error: unknown): string {
  if (error instanceof GitExecError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): "error" | "timeout" {
  return TIMEOUT_RE.test(errorMessage(error)) ? "timeout" : "error";
}

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(MAX_BRANCH_LIMIT, limit ?? DEFAULT_BRANCH_LIMIT));
}

function branchSearchArgs(): string[] {
  return [
    "for-each-ref",
    "--sort=-committerdate",
    `--format=%(refname)${BRANCH_FIELD_SEPARATOR}%(refname:short)${BRANCH_FIELD_SEPARATOR}%(objectname:short)${BRANCH_FIELD_SEPARATOR}%(HEAD)${BRANCH_FIELD_SEPARATOR}%(subject)${BRANCH_FIELD_SEPARATOR}%(authorname)${BRANCH_FIELD_SEPARATOR}%(committerdate:iso-strict)${BRANCH_FIELD_SEPARATOR}%(upstream:short)${BRANCH_FIELD_SEPARATOR}%(upstream:track)${BRANCH_RECORD_SEPARATOR}`,
    "refs/heads",
    "refs/remotes",
  ];
}

function branchKind(refName: string): GitDiffBranchOption["kind"] | null {
  if (refName.startsWith("refs/remotes/")) {
    return "remote";
  }
  if (refName.startsWith("refs/heads/")) {
    return "local";
  }
  return null;
}

function branchOptionFromRecord(
  record: string,
  current: null | string
): { currentBranch: null | string; item: GitDiffBranchOption | null } {
  const trimmed = record.trim();
  if (!trimmed) {
    return { currentBranch: null, item: null };
  }
  const [
    refName = "",
    shortName = "",
    commit = "",
    head = "",
    subject = "",
    authorName = "",
    committerDate = "",
    ,
    upstreamTrack = "",
  ] = trimmed.split(BRANCH_FIELD_SEPARATOR);
  const kind = branchKind(refName);
  if (
    !(kind && shortName) ||
    (kind === "remote" && REMOTE_HEAD_RE.test(refName))
  ) {
    return { currentBranch: null, item: null };
  }
  const name = shortName;
  const isCurrent = head === "*" || (current !== null && shortName === current);
  // 字段名沿用既有 renderer 契约；值对齐 VS Code，表示本地分支相对上游的 track 状态。
  const { ahead, behind } = parseUpstreamTrack(kind, upstreamTrack);
  return {
    currentBranch: head === "*" ? shortName : null,
    item: isCurrent
      ? null
      : {
          aheadFromCurrent: ahead,
          authorName: authorName || null,
          behindFromCurrent: behind,
          commit: commit || null,
          committerDate: committerDate || null,
          current: isCurrent,
          id: refName,
          kind,
          label: name,
          name,
          pinReason: null,
          refName,
          subject: subject || null,
        },
  };
}

function parseTrackCount(pattern: RegExp, track: string): null | number {
  const raw = pattern.exec(track)?.[1];
  if (raw === undefined) {
    return null;
  }
  const count = Number.parseInt(raw, 10);
  return Number.isFinite(count) ? count : null;
}

function parseUpstreamTrack(
  kind: GitDiffBranchOption["kind"] | null,
  upstreamTrack: string
): { ahead: null | number; behind: null | number } {
  const track = upstreamTrack.trim();
  if (kind !== "local" || track.length === 0) {
    return { ahead: null, behind: null };
  }
  if (track === "[gone]") {
    return { ahead: 0, behind: 0 };
  }
  return {
    ahead: parseTrackCount(TRACK_AHEAD_RE, track) ?? 0,
    behind: parseTrackCount(TRACK_BEHIND_RE, track) ?? 0,
  };
}

function parseBranchRecords(
  stdout: string,
  currentBranch: null | string | undefined
): { currentBranch: null | string; items: GitDiffBranchOption[] } {
  const current = currentBranch?.trim() || null;
  let detectedCurrentBranch = current;
  const seen = new Set<string>();
  const items: GitDiffBranchOption[] = [];

  for (const record of stdout.split(BRANCH_RECORD_SEPARATOR)) {
    const { currentBranch: detected, item } = branchOptionFromRecord(
      record,
      current
    );
    if (detected) {
      detectedCurrentBranch = detected;
    }
    if (item && !seen.has(item.refName)) {
      seen.add(item.refName);
      items.push(item);
    }
  }

  return { currentBranch: detectedCurrentBranch, items };
}

async function resolveDefaultBranchName(
  execGit: GitBranchSearchExec,
  cwd: string
): Promise<null | string> {
  try {
    const out = (
      await execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd)
    ).trim();
    return ORIGIN_HEAD_RE.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

function applyPins(
  items: GitDiffBranchOption[],
  defaultBranchName: null | string
): GitDiffBranchOption[] {
  let defaultIndex = -1;
  if (defaultBranchName) {
    defaultIndex = items.findIndex(
      (item) => item.kind === "local" && item.name === defaultBranchName
    );
    if (defaultIndex < 0) {
      defaultIndex = items.findIndex(
        (item) =>
          item.kind === "remote" && item.name === `origin/${defaultBranchName}`
      );
    }
  }
  if (defaultIndex < 0) {
    return items;
  }
  const defaultItem = items[defaultIndex];
  if (!defaultItem) {
    return items;
  }
  const next: GitDiffBranchOption[] = [
    { ...defaultItem, pinReason: "default" },
  ];
  for (const [index, item] of items.entries()) {
    if (index !== defaultIndex) {
      next.push(item);
    }
  }
  return next;
}

function groupBranchesByKind(
  items: readonly GitDiffBranchOption[]
): GitDiffBranchOption[] {
  const pinned: GitDiffBranchOption[] = [];
  const locals: GitDiffBranchOption[] = [];
  const remotes: GitDiffBranchOption[] = [];
  for (const item of items) {
    if (item.pinReason !== null) {
      pinned.push(item);
    } else if (item.kind === "local") {
      locals.push(item);
    } else {
      remotes.push(item);
    }
  }
  return [...pinned, ...locals, ...remotes];
}

export async function searchBranches(
  execGit: GitBranchSearchExec,
  cwd: string,
  options: GitBranchSearchOptions = {}
): Promise<GitDiffBranchesResult> {
  const startedAt = Date.now();
  try {
    const root = await validateGitCwd(execGit, cwd);
    if (!root) {
      throw new Error("Invalid git repository");
    }
    const [stdout, defaultBranchName] = await Promise.all([
      execGit(branchSearchArgs(), root),
      resolveDefaultBranchName(execGit, root),
    ]);
    const parsed = parseBranchRecords(stdout, options.currentBranch);
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const grouped = groupBranchesByKind(
      applyPins(parsed.items, defaultBranchName)
    );
    const filtered = query
      ? grouped.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : grouped;
    const sliced = filtered.slice(0, normalizeLimit(options.limit));
    return {
      currentBranch: parsed.currentBranch,
      durationMs: durationSince(startedAt),
      items: sliced,
      message: null,
      status: "ok",
    };
  } catch (error) {
    return {
      currentBranch: null,
      durationMs: durationSince(startedAt),
      items: [],
      message: errorMessage(error),
      status: errorStatus(error),
    };
  }
}
