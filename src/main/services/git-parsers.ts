/**
 * git CLI 输出的纯函数解析器。集中在此让 git-service.ts 仅聚焦于 service 编排。
 * 所有解析器都接受字符串、不发副作用、不依赖任何运行时状态;便于单测喂 fixture。
 */
import type {
  GitBranchInfo,
  GitBranchRef,
  GitCommit,
  GitDiffFilePatch,
  GitDiffHunk,
  GitDiffPatch,
  GitDiffStat,
  GitFileStatus,
  GitStatus,
} from "../../shared/contracts/git.ts";

const BRANCH_AB_RE = /^\+(\d+) -(\d+)$/;
const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function applyBranchHeader(branch: GitBranchInfo, header: string): void {
  if (header.startsWith("branch.head ")) {
    const name = header.slice("branch.head ".length);
    branch.branch = name === "(detached)" ? null : name;
    return;
  }
  if (header.startsWith("branch.upstream ")) {
    branch.upstream = header.slice("branch.upstream ".length);
    return;
  }
  if (header.startsWith("branch.ab ")) {
    const match = BRANCH_AB_RE.exec(header.slice("branch.ab ".length));
    if (match) {
      branch.ahead = Number(match[1]);
      branch.behind = Number(match[2]);
    }
  }
}

/** ordinary 条目：`1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` */
function parseOrdinaryEntry(record: string): GitFileStatus {
  return {
    index: record.charAt(2),
    origPath: null,
    path: record.split(" ").slice(8).join(" "),
    worktree: record.charAt(3),
  };
}

/** rename/copy 条目：`2 <XY> ... <Xscore> <path>`，紧跟一条 origPath 记录 */
function parseRenamedEntry(record: string, origPath: string): GitFileStatus {
  return {
    index: record.charAt(2),
    origPath,
    path: record.split(" ").slice(9).join(" "),
    worktree: record.charAt(3),
  };
}

/** unmerged 条目：`u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` */
function parseUnmergedEntry(record: string): GitFileStatus {
  return {
    index: record.charAt(2),
    origPath: null,
    path: record.split(" ").slice(10).join(" "),
    worktree: record.charAt(3),
  };
}

/**
 * 解析 `git status --porcelain=v2 --branch -z` 的输出。
 * 记录以 NUL 分隔；"# " 开头是分支 header,"1"/"2"/"u"/"?" 开头是文件条目。
 * rename("2")额外占用紧跟的 origPath 记录。
 */
export function parseGitStatus(output: string): GitStatus {
  const branch: GitBranchInfo = {
    ahead: 0,
    behind: 0,
    branch: null,
    upstream: null,
  };
  const files: GitFileStatus[] = [];
  const records = output.split("\0");

  let index = 0;
  while (index < records.length) {
    const record = records[index] ?? "";
    if (record.length === 0) {
      index += 1;
      continue;
    }
    const tag = record.charAt(0);
    if (tag === "#") {
      applyBranchHeader(branch, record.slice(2));
    } else if (tag === "1") {
      files.push(parseOrdinaryEntry(record));
    } else if (tag === "2") {
      files.push(parseRenamedEntry(record, records[index + 1] ?? ""));
      index += 1;
    } else if (tag === "u") {
      files.push(parseUnmergedEntry(record));
    } else if (tag === "?") {
      files.push({
        index: "?",
        origPath: null,
        path: record.slice(2),
        worktree: "?",
      });
    }
    index += 1;
  }

  return { branch, files };
}

/**
 * 解析 `git log --format=%H%x1f%an%x1f%aI%x1f%s%x1e` 的输出。
 * 字段用 US(\x1f) 分隔、记录用 RS(\x1e) 分隔,避免与路径/message 内容歧义。
 */
export function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of output.split("\x1e")) {
    const trimmed = record.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const fields = trimmed.split("\x1f");
    commits.push({
      author: fields[1] ?? "",
      date: fields[2] ?? "",
      hash: fields[0] ?? "",
      message: fields[3] ?? "",
    });
  }
  return commits;
}

/**
 * 解析 `git diff --numstat -z --no-renames` 的输出。
 * 每条 `adds\tdels\tpath`(NUL 分隔);binary 文件 adds/dels 为 "-"。
 * path 可能含 tab,故只切前两个 tab,剩余整段作 path。
 */
export function parseGitNumstat(output: string): GitDiffStat[] {
  const stats: GitDiffStat[] = [];
  for (const record of output.split("\0")) {
    if (record.length === 0) {
      continue;
    }
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab === -1 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) {
      continue;
    }
    const addsRaw = record.slice(0, firstTab);
    const delsRaw = record.slice(firstTab + 1, secondTab);
    const binary = addsRaw === "-" || delsRaw === "-";
    stats.push({
      binary,
      deletions: binary ? 0 : Number(delsRaw),
      insertions: binary ? 0 : Number(addsRaw),
      path: record.slice(secondTab + 1),
    });
  }
  return stats;
}

function startNewFile(line: string): GitDiffFilePatch | null {
  if (!line.startsWith("diff --git ")) {
    return null;
  }
  const match = DIFF_HEADER_RE.exec(line);
  return {
    binary: false,
    hunks: [],
    oldPath: null,
    path: match?.[2] ?? "",
  };
}

/** 处理 binary / rename / --- / +++ 等文件元信息行;命中返回 true。 */
function applyFileMetadata(current: GitDiffFilePatch, line: string): boolean {
  if (line.startsWith("Binary files ")) {
    current.binary = true;
    return true;
  }
  if (line.startsWith("rename from ")) {
    current.oldPath = line.slice("rename from ".length);
    return true;
  }
  if (line.startsWith("rename to ")) {
    current.path = line.slice("rename to ".length);
    return true;
  }
  if (line.startsWith("--- ")) {
    const p = line.slice(4);
    if (p !== "/dev/null" && p.startsWith("a/")) {
      const oldName = p.slice(2);
      if (oldName !== current.path) {
        current.oldPath = oldName;
      }
    }
    return true;
  }
  if (line.startsWith("+++ ")) {
    const p = line.slice(4);
    if (p !== "/dev/null" && p.startsWith("b/")) {
      current.path = p.slice(2);
    }
    return true;
  }
  return false;
}

function startNewHunk(line: string): GitDiffHunk | null {
  const match = HUNK_HEADER_RE.exec(line);
  if (!match) {
    return null;
  }
  return {
    lines: [],
    newLines: Number(match[4] ?? "1"),
    newStart: Number(match[3]),
    oldLines: Number(match[2] ?? "1"),
    oldStart: Number(match[1]),
  };
}

function appendHunkLine(hunk: GitDiffHunk, line: string): void {
  const tag = line.charAt(0);
  if (tag === "+") {
    hunk.lines.push({ kind: "add", text: line.slice(1) });
  } else if (tag === "-") {
    hunk.lines.push({ kind: "del", text: line.slice(1) });
  } else if (tag === " ") {
    hunk.lines.push({ kind: "context", text: line.slice(1) });
  }
}

/**
 * 解析 git 原生 unified diff 文本为结构化 patch(files + hunks + lines)。
 * 让 diff 渲染插件不必各自实现解析器;只输出数据,不渲染。
 * 不支持的形式(合并冲突 --combined / --cc)会被静默忽略。
 */
export function parseUnifiedDiff(text: string): GitDiffPatch {
  const files: GitDiffFilePatch[] = [];
  let current: GitDiffFilePatch | null = null;
  let hunk: GitDiffHunk | null = null;

  function flushHunk(): void {
    if (hunk && current) {
      current.hunks.push(hunk);
      hunk = null;
    }
  }
  function flushFile(): void {
    flushHunk();
    if (current) {
      files.push(current);
      current = null;
    }
  }

  for (const line of text.split("\n")) {
    const newFile = startNewFile(line);
    if (newFile) {
      flushFile();
      current = newFile;
      continue;
    }
    if (!current) {
      continue;
    }
    if (applyFileMetadata(current, line)) {
      continue;
    }
    const newHunk = startNewHunk(line);
    if (newHunk) {
      flushHunk();
      hunk = newHunk;
      continue;
    }
    if (hunk) {
      appendHunkLine(hunk, line);
    }
  }
  flushFile();
  return { files };
}

/**
 * 解析 `git for-each-ref --format=%(refname)%00%(upstream:short)%00%(objectname)%00%(HEAD)` 输出。
 * refname 完整路径(refs/heads/x 或 refs/remotes/origin/x);HEAD 字段 "*" 表示当前分支。
 * 记录用换行分隔;字段用 NUL 分隔,避免 upstream 名含特殊字符。
 */
export function parseGitBranchRefs(output: string): GitBranchRef[] {
  const refs: GitBranchRef[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const fields = line.split("\0");
    const refname = fields[0] ?? "";
    const upstream = fields[1] ?? "";
    const oid = fields[2] ?? "";
    const headMark = fields[3] ?? "";
    let kind: "local" | "remote";
    let name: string;
    if (refname.startsWith("refs/heads/")) {
      kind = "local";
      name = refname.slice("refs/heads/".length);
    } else if (refname.startsWith("refs/remotes/")) {
      kind = "remote";
      name = refname.slice("refs/remotes/".length);
    } else {
      continue;
    }
    refs.push({
      isCurrent: headMark === "*",
      kind,
      lastCommit: oid,
      name,
      upstream: upstream.length > 0 ? upstream : null,
    });
  }
  return refs;
}
