import type { z } from "zod";
import type {
  GitBranchRef,
  GitCommit,
  GitDiffPatch,
  GitDiffSummary,
  GitRepoInfo,
  GitStatus,
  getFileContentOptionsSchema,
  gitCommitOptionsSchema,
  gitCreateBranchOptionsSchema,
  gitDeleteBranchOptionsSchema,
  gitDiffOptionsSchema,
  gitLogOptionsSchema,
  gitPathsSchema,
  listBranchesOptionsSchema,
} from "../../shared/contracts/git.ts";
import { execGit } from "./git-exec.ts";
import {
  deriveCounts,
  parseGitBranchRefs,
  parseGitLog,
  parseGitNumstat,
  parseGitStatus,
  parseUnifiedDiff,
} from "./git-parsers.ts";
import {
  detectRepoState,
  detectUpstreamGone,
  getLineDelta,
  getStashCount,
} from "./git-status-detectors.ts";

const GIT_LOG_FORMAT = "%H%x1f%an%x1f%aI%x1f%s%x1e";
const ORIGIN_HEAD_RE = /^refs\/remotes\/origin\/(.+)$/;

/** 从 contracts schema 派生的 IPC 兼容 option 类型,避免 exactOptionalPropertyTypes 冲突。 */
export type GitDiffOptions = z.infer<typeof gitDiffOptionsSchema>;
export type GitLogOptions = z.infer<typeof gitLogOptionsSchema>;
export type ListBranchesOptions = z.infer<typeof listBranchesOptionsSchema>;
export type GetFileContentOptions = z.infer<typeof getFileContentOptionsSchema>;
export type GitPathsRequest = z.infer<typeof gitPathsSchema>;
export type GitCommitOptions = z.infer<typeof gitCommitOptionsSchema>;
export type GitCreateBranchOptions = z.infer<
  typeof gitCreateBranchOptionsSchema
>;
export type GitDeleteBranchOptions = z.infer<
  typeof gitDeleteBranchOptionsSchema
>;

/** 写操作统一 60s 超时(避免大仓库继承 git-exec 默认 10s 失败)。 */
const WRITE_TIMEOUT_MS = 60_000;

/**
 * branch name 不允许以 "-" 开头,否则 git 会把它当 flag(`git branch --help` 等)。
 * spawn argv 模式虽不构成 shell 注入,但语义会被破坏:任何拿到 git:write 的插件
 * 传 `name: "--force"` 都会触发非预期分支。
 */
function assertSafeBranchName(name: string): void {
  if (name.startsWith("-")) {
    throw new Error(
      `branch name must not start with "-" (would be interpreted as git flag): ${name}`
    );
  }
}

export interface GitService {
  checkoutBranch(cwd: string, name: string): Promise<void>;
  commit(cwd: string, options: GitCommitOptions): Promise<void>;
  createBranch(cwd: string, options: GitCreateBranchOptions): Promise<void>;
  deleteBranch(cwd: string, options: GitDeleteBranchOptions): Promise<void>;
  discardChanges(cwd: string, request: GitPathsRequest): Promise<void>;
  // —— 读 ——
  getCommit(cwd: string, oid: string): Promise<GitCommit>;
  getCommitPatch(cwd: string, oid: string): Promise<GitDiffPatch>;
  getDiffPatch(cwd: string, options?: GitDiffOptions): Promise<GitDiffPatch>;
  getDiffSummary(
    cwd: string,
    options?: GitDiffOptions
  ): Promise<GitDiffSummary>;
  getDiffText(cwd: string, options?: GitDiffOptions): Promise<string>;
  getFileContent(cwd: string, options: GetFileContentOptions): Promise<string>;
  getLog(cwd: string, options?: GitLogOptions): Promise<GitCommit[]>;
  getRepoInfo(cwd: string): Promise<GitRepoInfo>;
  getStatus(cwd: string): Promise<GitStatus>;
  isWorkingTreeClean(cwd: string): Promise<boolean>;
  listBranches(
    cwd: string,
    options: ListBranchesOptions
  ): Promise<GitBranchRef[]>;
  listTags(cwd: string): Promise<string[]>;
  resolveRef(cwd: string, ref: string): Promise<string>;
  // —— 写(需 git:write capability) ——
  stage(cwd: string, request: GitPathsRequest): Promise<void>;
  unstage(cwd: string, request: GitPathsRequest): Promise<void>;
  validateBranchName(cwd: string, name: string): Promise<boolean>;
}

export interface CreateGitServiceOptions {
  execGit?: (
    args: readonly string[],
    cwd: string,
    options?: { timeoutMs?: number }
  ) => Promise<string>;
}

function diffRangeArgs(options: GitDiffOptions): string[] {
  const args: string[] = [];
  if (options.staged) {
    args.push("--cached");
  }
  if (options.from && options.to) {
    args.push(`${options.from}..${options.to}`);
  } else if (options.from) {
    args.push(options.from);
  }
  if (options.paths && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }
  return args;
}

function logArgs(options: GitLogOptions): string[] {
  const maxCount = options.maxCount ?? 50;
  const args: string[] = [
    "log",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${maxCount}`,
  ];
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  if (options.grep) {
    args.push(`--grep=${options.grep}`);
  }
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  if (options.until) {
    args.push(`--until=${options.until}`);
  }
  if (options.path) {
    args.push("--", options.path);
  }
  return args;
}

function defaultExecGit(
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

async function readHeadOid(
  cwd: string,
  exec: (args: readonly string[], cwd: string) => Promise<string>
): Promise<string | null> {
  try {
    return (await exec(["rev-parse", "--verify", "HEAD"], cwd)).trim();
  } catch {
    return null;
  }
}

async function readDefaultBranch(
  cwd: string,
  exec: (args: readonly string[], cwd: string) => Promise<string>
): Promise<string | null> {
  try {
    const out = (
      await exec(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd)
    ).trim();
    return ORIGIN_HEAD_RE.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * 核心 Git 服务(main 进程)。默认 spawn 原生 git(execGit 可注入便于测试)。
 * 读写授权在命令入口按 git:read/git:write 控制; 本层负责参数化执行和解析。
 */
export function createGitService({
  execGit = defaultExecGit,
}: CreateGitServiceOptions = {}): GitService {
  return {
    getCommit: async (cwd, oid) => {
      const output = await execGit(
        ["log", "-1", `--format=${GIT_LOG_FORMAT}`, oid],
        cwd
      );
      const head = parseGitLog(output)[0];
      if (head === undefined) {
        throw new Error(`commit not found: ${oid}`);
      }
      return head;
    },
    getCommitPatch: async (cwd, oid) => {
      const text = await execGit(
        ["show", "--format=", "--no-color", "--no-ext-diff", oid],
        cwd
      );
      return parseUnifiedDiff(text);
    },
    getDiffSummary: async (cwd, options = {}) => {
      const output = await execGit(
        ["diff", "--numstat", "-z", "--no-renames", ...diffRangeArgs(options)],
        cwd
      );
      const files = parseGitNumstat(output);
      return {
        changed: files.length,
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        files,
        insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      };
    },
    getDiffPatch: async (cwd, options = {}) => {
      const text = await execGit(
        ["diff", "--no-color", "--no-ext-diff", ...diffRangeArgs(options)],
        cwd
      );
      return parseUnifiedDiff(text);
    },
    getDiffText: (cwd, options = {}) =>
      execGit(
        ["diff", "--no-color", "--no-ext-diff", ...diffRangeArgs(options)],
        cwd
      ),
    getFileContent: (cwd, options) =>
      execGit(["show", `${options.ref ?? "HEAD"}:${options.path}`], cwd),
    getLog: async (cwd, options = {}) => {
      const output = await execGit(logArgs(options), cwd);
      return parseGitLog(output);
    },
    getRepoInfo: async (cwd) => {
      // --path-format=absolute 让 --git-common-dir 也返回绝对路径
      // (默认它返回相对路径 ".git",会让 isWorktree 在普通仓库假阳性为 true)
      const pathOutput = await execGit(
        [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--absolute-git-dir",
          "--git-common-dir",
        ],
        cwd
      );
      const lines = pathOutput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const gitRoot = lines[0] ?? "";
      const gitDir = lines[1] ?? "";
      const gitCommonDir = lines[2] ?? "";
      const bareOutput = (
        await execGit(["rev-parse", "--is-bare-repository"], cwd)
      ).trim();
      const [headOid, defaultBranch] = await Promise.all([
        readHeadOid(cwd, execGit),
        readDefaultBranch(cwd, execGit),
      ]);
      return {
        defaultBranch,
        gitCommonDir,
        gitDir,
        gitRoot,
        headOid,
        isBare: bareOutput === "true",
        isWorktree: gitDir !== gitCommonDir,
      };
    },
    getStatus: async (cwd) => {
      // wave 1：可并发的独立 op（status 输出 + 增删 + stash + gitDir 解析）
      const [statusOut, delta, stashCount, gitDirOut] = await Promise.all([
        execGit(["status", "--porcelain=v2", "--branch", "-z"], cwd),
        getLineDelta(execGit, cwd),
        getStashCount(execGit, cwd),
        execGit(
          ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
          cwd
        ),
      ]);
      const parsed = parseGitStatus(statusOut);
      const counts = deriveCounts(parsed.files);
      // wave 2：依赖 wave 1 的派生值（gitDir + conflictCount / branch 名）
      const gitDir = gitDirOut.trim();
      const [repoState, upstreamGone] = await Promise.all([
        detectRepoState(gitDir, counts.conflict),
        detectUpstreamGone(execGit, cwd, parsed.branch.branch),
      ]);
      return {
        branch: {
          ahead: parsed.branch.ahead,
          behind: parsed.branch.behind,
          branch: parsed.branch.branch,
          oid: parsed.branch.oid,
          upstream: parsed.branch.upstream,
          upstreamGone,
        },
        counts,
        delta,
        files: parsed.files,
        repoState,
        stashCount,
      };
    },
    isWorkingTreeClean: async (cwd) => {
      const output = await execGit(
        ["status", "--porcelain=v2", "--branch", "-z"],
        cwd
      );
      return parseGitStatus(output).files.length === 0;
    },
    listBranches: async (cwd, options) => {
      const refs = ["refs/heads", "refs/remotes"].filter((ref) => {
        if (options.kind === "local") {
          return ref === "refs/heads";
        }
        if (options.kind === "remote") {
          return ref === "refs/remotes";
        }
        return true;
      });
      const output = await execGit(
        [
          "for-each-ref",
          "--format=%(refname)%00%(upstream:short)%00%(objectname)%00%(HEAD)",
          ...refs,
        ],
        cwd
      );
      return parseGitBranchRefs(output);
    },
    listTags: async (cwd) => {
      const output = await execGit(
        ["for-each-ref", "--format=%(refname:short)", "refs/tags"],
        cwd
      );
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
    resolveRef: async (cwd, ref) => {
      const output = await execGit(["rev-parse", "--verify", ref], cwd);
      return output.trim();
    },
    validateBranchName: async (cwd, name) => {
      try {
        await execGit(["check-ref-format", "--branch", name], cwd);
        return true;
      } catch {
        return false;
      }
    },
    // —— 写操作:全部传 timeoutMs 60s ——
    stage: async (cwd, request) => {
      if (request.paths.length === 0) {
        throw new Error("stage requires at least one path");
      }
      await execGit(["add", "--", ...request.paths], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    unstage: async (cwd, request) => {
      if (request.paths.length === 0) {
        throw new Error("unstage requires at least one path");
      }
      await execGit(["restore", "--staged", "--", ...request.paths], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    discardChanges: async (cwd, request) => {
      if (request.paths.length === 0) {
        throw new Error("discardChanges requires at least one path");
      }
      await execGit(["restore", "--", ...request.paths], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    commit: async (cwd, options) => {
      const args = ["commit", "-m", options.message];
      if (options.signoff) {
        args.push("--signoff");
      }
      if (options.allowEmpty) {
        args.push("--allow-empty");
      }
      await execGit(args, cwd, { timeoutMs: WRITE_TIMEOUT_MS });
    },
    createBranch: async (cwd, options) => {
      assertSafeBranchName(options.name);
      const args = ["branch", options.name];
      if (options.startPoint) {
        args.push(options.startPoint);
      }
      await execGit(args, cwd, { timeoutMs: WRITE_TIMEOUT_MS });
    },
    deleteBranch: async (cwd, options) => {
      assertSafeBranchName(options.name);
      await execGit(
        ["branch", options.force ? "-D" : "-d", options.name],
        cwd,
        { timeoutMs: WRITE_TIMEOUT_MS }
      );
    },
    checkoutBranch: async (cwd, name) => {
      assertSafeBranchName(name);
      await execGit(["switch", name], cwd, { timeoutMs: WRITE_TIMEOUT_MS });
    },
  };
}
