import type {
  GitCommit,
  GitCommitSearchResult,
} from "../../shared/contracts/git.ts";
import { validateGitCwd } from "./git-cwd.ts";
import { GitExecError } from "./git-exec.ts";
import { parseGitLog } from "./git-parsers.ts";

const COMMIT_LOG_FORMAT = "%H%x1f%an%x1f%aI%x1f%s%x1e";
const DEFAULT_COMMIT_LIMIT = 50;
const MAX_COMMIT_LIMIT = 200;
const SEARCH_TIMEOUT_MS = 5000;
/** `all:` 只作为整条查询的前缀生效,避免误伤消息词或路径 token。 */
const ALL_SCOPE_PREFIX_RE = /^all:\s*/i;
// 64 位上限覆盖 SHA-256 仓库的完整 hash。
const BARE_HASH_RE = /^#?[0-9a-f]{4,64}$/i;
const DATE_TOKEN_RE = /^(since|until):(.+)$/i;
const SPLIT_WS_RE = /\s+/;

export type GitCommitSearchExec = (
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<string>;

export interface GitCommitSearchOptions {
  limit?: number | undefined;
  query?: string | undefined;
}

interface CommitQueryPlan {
  args: string[];
  /** 精确 hash 查询;`#` 前缀表示显式意图(未命中不再退化为消息搜索)。 */
  hash: { explicit: boolean; value: string } | null;
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
  return error instanceof GitExecError && error.causeKind === "timeout"
    ? "timeout"
    : "error";
}

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(MAX_COMMIT_LIMIT, limit ?? DEFAULT_COMMIT_LIMIT));
}

/** 路径 token 白名单校验：拒绝绝对路径、`-` 开头（选项注入）、`..` 逃逸。 */
function isSafeRelativeGitPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("-") &&
    !value.includes("\0") &&
    !value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

/**
 * 把结构化查询编译为 `git log` 参数。语法见 contracts/git.ts 的
 * gitSearchCommitsOptionsSchema 注释。整条 query 是裸 hash 时走精确查
 * (可经 allowHashFastPath=false 禁用,用于精确查未命中后的消息搜索回退)。
 *
 * 统一使用 --fixed-strings:git 的 grep 类标志是全局的,会同时作用于
 * --author 与 --grep;固定字符串匹配下 author 不需要(也不能)做正则转义。
 */
function buildCommitQueryPlan(
  rawQuery: string,
  limit: number,
  allowHashFastPath = true
): CommitQueryPlan {
  let normalized = rawQuery.trim();
  let allRefs = false;
  if (ALL_SCOPE_PREFIX_RE.test(normalized)) {
    allRefs = true;
    normalized = normalized.replace(ALL_SCOPE_PREFIX_RE, "").trim();
  }
  if (allowHashFastPath && BARE_HASH_RE.test(normalized)) {
    return {
      args: [],
      hash: {
        explicit: normalized.startsWith("#"),
        value: normalized.replace(/^#/, ""),
      },
    };
  }
  const args = [
    "log",
    allRefs ? "--all" : "HEAD",
    `--max-count=${limit}`,
    `--format=${COMMIT_LOG_FORMAT}`,
    "--regexp-ignore-case",
    "--fixed-strings",
  ];
  const messageTerms: string[] = [];
  const pathTerms: string[] = [];
  let pickaxeTerm: string | null = null;
  for (const token of normalized.split(SPLIT_WS_RE)) {
    if (token.length === 0) {
      continue;
    }
    const dateMatch = DATE_TOKEN_RE.exec(token);
    if (dateMatch) {
      // toLowerCase 而非 toLocaleLowerCase:土耳其语系 locale 下 "SINCE" 的
      // 本地化小写不是 "since",会被误路由到 --until。
      const flag =
        dateMatch[1]?.toLowerCase() === "since" ? "--since" : "--until";
      args.push(`${flag}=${dateMatch[2] ?? ""}`);
      continue;
    }
    if (token.startsWith("@") && token.length > 1) {
      args.push(`--author=${token.slice(1)}`);
      continue;
    }
    if (token.startsWith(":") && token.length > 1) {
      const gitPath = token.slice(1);
      if (!isSafeRelativeGitPath(gitPath)) {
        throw new Error(`unsafe path query: ${gitPath}`);
      }
      pathTerms.push(gitPath);
      continue;
    }
    if (token.startsWith("~") && token.length > 1) {
      // git 对多个 -S 只保留最后一个;仅取第一个 ~token,后续按消息词处理,
      // 避免静默丢弃查询条件。
      if (pickaxeTerm === null) {
        pickaxeTerm = token.slice(1);
      } else {
        messageTerms.push(token.slice(1));
      }
      continue;
    }
    messageTerms.push(token);
  }
  if (pickaxeTerm !== null) {
    args.push(`-S${pickaxeTerm}`, "--pickaxe-all");
  }
  const messageQuery = messageTerms.join(" ").trim();
  if (messageQuery) {
    args.push(`--grep=${messageQuery}`);
  }
  if (pathTerms.length > 0) {
    args.push("--", ...pathTerms);
  }
  return { args, hash: null };
}

async function searchCommitByHash(
  execGit: GitCommitSearchExec,
  cwd: string,
  hash: string
): Promise<GitCommit[]> {
  try {
    const output = await execGit(
      ["log", "-1", `--format=${COMMIT_LOG_FORMAT}`, hash, "--"],
      cwd,
      { timeoutMs: SEARCH_TIMEOUT_MS }
    );
    return parseGitLog(output);
  } catch (error) {
    // hash 不存在按空结果处理（用户输错前缀是常态,不是错误）
    if (error instanceof GitExecError && error.causeKind === "exit") {
      return [];
    }
    throw error;
  }
}

async function runCommitLog(
  execGit: GitCommitSearchExec,
  cwd: string,
  args: readonly string[]
): Promise<GitCommit[]> {
  return parseGitLog(
    await execGit(args, cwd, { timeoutMs: SEARCH_TIMEOUT_MS })
  );
}

export async function searchCommits(
  execGit: GitCommitSearchExec,
  cwd: string,
  options: GitCommitSearchOptions = {}
): Promise<GitCommitSearchResult> {
  const startedAt = Date.now();
  const query = options.query ?? "";
  const limit = normalizeLimit(options.limit);
  try {
    const root = await validateGitCwd(execGit, cwd);
    if (!root) {
      throw new Error("Invalid git repository");
    }
    const plan = buildCommitQueryPlan(query, limit);
    let items: GitCommit[];
    if (plan.hash === null) {
      items = await runCommitLog(execGit, root, plan.args);
    } else {
      items = await searchCommitByHash(execGit, root, plan.hash.value);
      if (items.length === 0 && !plan.hash.explicit) {
        // 形似 hash 的普通词（added/dead/cafe…）未命中时退化为消息搜索。
        const fallback = buildCommitQueryPlan(query, limit, false);
        items = await runCommitLog(execGit, root, fallback.args);
      }
    }
    return {
      durationMs: durationSince(startedAt),
      items,
      message: null,
      status: "ok",
    };
  } catch (error) {
    return {
      durationMs: durationSince(startedAt),
      items: [],
      message: errorMessage(error),
      status: errorStatus(error),
    };
  }
}
