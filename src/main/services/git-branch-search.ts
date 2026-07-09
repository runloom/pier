import type {
  GitBranchTipTreeInCurrentHistory,
  GitDiffBranchesResult,
  GitDiffBranchOption,
} from "../../shared/contracts/git.ts";
import { validateGitCwd } from "./git-cwd.ts";
import { GitExecError } from "./git-exec.ts";
import { mergeWouldKeepHeadTree } from "./git-merge-preview.ts";

const AHEAD_BEHIND_CONCURRENCY = 8;
const AHEAD_BEHIND_HYDRATE_MAX = 20;
const AHEAD_BEHIND_TIMEOUT_MS = 2000;
const BRANCH_FIELD_SEPARATOR = "\x1f";
const BRANCH_RECORD_SEPARATOR = "\x1e";
const DEFAULT_BRANCH_LIMIT = 20;
// 命令面板本地过滤需要全量候选,上限只作为 IPC payload 安全阀。
const MAX_BRANCH_LIMIT = 1000;
const ORIGIN_HEAD_RE = /^refs\/remotes\/[^/]+\/(.+)$/;
const REMOTE_HEAD_RE = /\/HEAD$/;
const SPLIT_WS_RE = /\s+/;
const TIMEOUT_RE = /timeout|timed out|超时/i;
const TREE_HISTORY_SCAN_MAX = 2000;
const TREE_HISTORY_TIMEOUT_MS = 2000;
const TREE_OID_RE = /^[0-9a-f]{40,64}$/i;

export type GitBranchSearchExec = (
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<string>;

export interface GitBranchSearchOptions {
  currentBranch?: null | string | undefined;
  diffMode?: "commitGraph" | "mergeIntoCurrent" | undefined;
  limit?: number | undefined;
  query?: string | undefined;
}

type BranchSearchItem = GitDiffBranchOption & {
  treeOid: null | string;
};

interface CurrentHistoryTreeMatch {
  commit: string;
  commitsSince: number;
  subject: null | string;
}

interface BranchRecordFields {
  authorName: string;
  commit: string;
  committerDate: string;
  head: string;
  kind: GitDiffBranchOption["kind"];
  refName: string;
  shortName: string;
  subject: string;
  treeOid: string;
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
    `--format=%(refname)${BRANCH_FIELD_SEPARATOR}%(refname:short)${BRANCH_FIELD_SEPARATOR}%(objectname:short)${BRANCH_FIELD_SEPARATOR}%(HEAD)${BRANCH_FIELD_SEPARATOR}%(subject)${BRANCH_FIELD_SEPARATOR}%(authorname)${BRANCH_FIELD_SEPARATOR}%(committerdate:iso-strict)${BRANCH_FIELD_SEPARATOR}%(upstream:short)${BRANCH_FIELD_SEPARATOR}%(upstream:track)${BRANCH_FIELD_SEPARATOR}%(tree)${BRANCH_RECORD_SEPARATOR}`,
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

function parseBranchRecordFields(record: string): BranchRecordFields | null {
  const trimmed = record.trim();
  if (!trimmed) {
    return null;
  }
  const fields = trimmed.split(BRANCH_FIELD_SEPARATOR);
  const refName = fields[0] ?? "";
  const shortName = fields[1] ?? "";
  const kind = branchKind(refName);
  if (
    !(kind && shortName) ||
    (kind === "remote" && REMOTE_HEAD_RE.test(refName))
  ) {
    return null;
  }
  return {
    authorName: fields[5] ?? "",
    commit: fields[2] ?? "",
    committerDate: fields[6] ?? "",
    head: fields[3] ?? "",
    kind,
    refName,
    shortName,
    subject: fields[4] ?? "",
    treeOid: fields[9] ?? "",
  };
}

function branchSearchItemFromFields(
  fields: BranchRecordFields,
  isCurrent: boolean
): BranchSearchItem | null {
  if (isCurrent) {
    return null;
  }
  return {
    aheadFromCurrent: null,
    authorName: fields.authorName || null,
    behindFromCurrent: null,
    commit: fields.commit || null,
    committerDate: fields.committerDate || null,
    current: isCurrent,
    id: fields.refName,
    kind: fields.kind,
    label: fields.shortName,
    name: fields.shortName,
    pinReason: null,
    refName: fields.refName,
    subject: fields.subject || null,
    tipTreeInCurrentHistory: null,
    treeOid: TREE_OID_RE.test(fields.treeOid) ? fields.treeOid : null,
  };
}

function branchOptionFromRecord(
  record: string,
  current: null | string
): { currentBranch: null | string; item: BranchSearchItem | null } {
  const fields = parseBranchRecordFields(record);
  if (fields === null) {
    return { currentBranch: null, item: null };
  }
  const isCurrent =
    fields.head === "*" || (current !== null && fields.shortName === current);
  return {
    currentBranch: fields.head === "*" ? fields.shortName : null,
    item: branchSearchItemFromFields(fields, isCurrent),
  };
}

function parseBranchRecords(
  stdout: string,
  currentBranch: null | string | undefined
): { currentBranch: null | string; items: BranchSearchItem[] } {
  const current = currentBranch?.trim() || null;
  let detectedCurrentBranch = current;
  const seen = new Set<string>();
  const items: BranchSearchItem[] = [];

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
  items: BranchSearchItem[],
  defaultBranchName: null | string
): BranchSearchItem[] {
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
  const next: BranchSearchItem[] = [{ ...defaultItem, pinReason: "default" }];
  for (const [index, item] of items.entries()) {
    if (index !== defaultIndex) {
      next.push(item);
    }
  }
  return next;
}

function groupBranchesByKind(
  items: readonly BranchSearchItem[]
): BranchSearchItem[] {
  const pinned: BranchSearchItem[] = [];
  const locals: BranchSearchItem[] = [];
  const remotes: BranchSearchItem[] = [];
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

async function computeAheadBehindFromCurrent(
  execGit: GitBranchSearchExec,
  cwd: string,
  refName: string,
  diffMode: GitBranchSearchOptions["diffMode"]
): Promise<{ ahead: null | number; behind: null | number }> {
  try {
    // 左侧是候选分支独有提交,右侧是当前 HEAD 独有提交。
    const output = await execGit(
      ["rev-list", "--left-right", "--count", `${refName}...HEAD`],
      cwd,
      { timeoutMs: AHEAD_BEHIND_TIMEOUT_MS }
    );
    const [aheadRaw = "", behindRaw = ""] = output.trim().split(SPLIT_WS_RE);
    const ahead = Number.parseInt(aheadRaw, 10);
    const behind = Number.parseInt(behindRaw, 10);
    if (!(Number.isFinite(ahead) && Number.isFinite(behind))) {
      return { ahead: null, behind: null };
    }
    if (diffMode === "mergeIntoCurrent") {
      if (
        ahead === 0 ||
        (await mergeWouldKeepHeadTree(execGit, cwd, refName))
      ) {
        return { ahead: 0, behind };
      }
      return { ahead, behind };
    }
    return { ahead, behind };
  } catch {
    return { ahead: null, behind: null };
  }
}

function parseCurrentHistoryTreeMatches(
  output: string
): Map<string, CurrentHistoryTreeMatch> {
  const matches = new Map<string, CurrentHistoryTreeMatch>();
  let commitsSince = 0;
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [tree = "", commit = "", subject = ""] = line.split(
      BRANCH_FIELD_SEPARATOR
    );
    if (TREE_OID_RE.test(tree) && commit.length > 0 && !matches.has(tree)) {
      matches.set(tree, {
        commit,
        commitsSince,
        subject: subject || null,
      });
    }
    commitsSince += 1;
  }
  return matches;
}

async function loadCurrentHistoryTreeMatches(
  execGit: GitBranchSearchExec,
  cwd: string,
  diffMode: GitBranchSearchOptions["diffMode"]
): Promise<Map<string, CurrentHistoryTreeMatch>> {
  if (diffMode !== "mergeIntoCurrent") {
    return new Map();
  }
  try {
    const output = await execGit(
      [
        "log",
        `--max-count=${TREE_HISTORY_SCAN_MAX}`,
        `--format=%T${BRANCH_FIELD_SEPARATOR}%h${BRANCH_FIELD_SEPARATOR}%s`,
        "HEAD",
      ],
      cwd,
      { timeoutMs: TREE_HISTORY_TIMEOUT_MS }
    );
    return parseCurrentHistoryTreeMatches(output);
  } catch {
    return new Map();
  }
}

function tipTreeInCurrentHistory(
  item: BranchSearchItem,
  currentHistoryTreeMatches: ReadonlyMap<string, CurrentHistoryTreeMatch>
): GitBranchTipTreeInCurrentHistory | null {
  if (item.treeOid === null) {
    return null;
  }
  return currentHistoryTreeMatches.get(item.treeOid) ?? null;
}

function stripInternalBranchFields(
  item: BranchSearchItem
): GitDiffBranchOption {
  const { treeOid: _treeOid, ...publicItem } = item;
  return publicItem;
}

async function hydrateAheadBehindFromCurrent(
  execGit: GitBranchSearchExec,
  cwd: string,
  items: readonly BranchSearchItem[],
  diffMode: GitBranchSearchOptions["diffMode"]
): Promise<GitDiffBranchOption[]> {
  const currentHistoryTreeMatches = await loadCurrentHistoryTreeMatches(
    execGit,
    cwd,
    diffMode
  );
  const results = items.map((item) => ({ ...item }));
  const hydrateCount = Math.min(results.length, AHEAD_BEHIND_HYDRATE_MAX);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < hydrateCount) {
      const index = cursor;
      cursor += 1;
      const item = results[index];
      if (!item) {
        continue;
      }
      const { ahead, behind } = await computeAheadBehindFromCurrent(
        execGit,
        cwd,
        item.refName,
        diffMode
      );
      item.aheadFromCurrent = ahead;
      item.behindFromCurrent = behind;
      item.tipTreeInCurrentHistory = tipTreeInCurrentHistory(
        item,
        currentHistoryTreeMatches
      );
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(AHEAD_BEHIND_CONCURRENCY, hydrateCount) },
      () => worker()
    )
  );
  return results.map(stripInternalBranchFields);
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
      items: await hydrateAheadBehindFromCurrent(
        execGit,
        root,
        sliced,
        options.diffMode
      ),
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
