import { createHash } from "node:crypto";

/**
 * repo 级共享 refs 表：一次 `for-each-ref` 的解析结果，同时服务
 * refs 签名（watch hub）、upstreamGone、默认分支解析与分支列表。
 * "数据源唯一"：所有 refs 派生值都从这张表读，不再各自 spawn。
 */
export interface RefsTableEntry {
  /** 指向的 commit oid；symref 条目（origin/HEAD）也有解析后的 oid。 */
  oid: string;
  /** 完整 refname，如 `refs/heads/main`、`refs/remotes/origin/HEAD`。 */
  refname: string;
  /** `%(symref)`：symbolic ref 的指向（origin/HEAD → refs/remotes/origin/main）。 */
  symref: string;
  /** `%(upstream:track)`：如 `[ahead 1, behind 2]` / `[gone]`，无则空串。 */
  track: string;
  /** `%(upstream)`：本地分支配置的 upstream 完整 ref，无则空串。 */
  upstream: string;
}

export interface RefsTable {
  entries: readonly RefsTableEntry[];
  /** 原始 for-each-ref 输出的 sha256，可直接用作 refs 签名。 */
  signature: string;
}

/** 与 defaultRefsSignature 共用的输出格式；track 变化蕴含 oid 变化，不引入额外触发。 */
export const REFS_TABLE_FORMAT =
  "%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)%00%(symref)";

export const REFS_TABLE_PATTERNS = [
  "refs/heads",
  "refs/remotes",
  "refs/stash",
] as const;

export function parseRefsTable(output: string): RefsTable {
  const entries: RefsTableEntry[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [refname = "", oid = "", upstream = "", track = "", symref = ""] =
      line.split("\0");
    if (refname.length === 0) {
      continue;
    }
    entries.push({ oid, refname, symref, track, upstream });
  }
  return {
    entries,
    signature: createHash("sha256").update(output).digest("hex"),
  };
}

/** detectors/assembler 注入的 exec 形态：(args, cwd) → stdout。 */
type RefsExec = (args: readonly string[], cwd: string) => Promise<string>;

/** 拉取并解析 refs 表。仓库不可用（非 git 目录等）返回 null。 */
export async function fetchRefsTable(
  exec: RefsExec,
  cwd: string
): Promise<RefsTable | null> {
  try {
    const output = await exec(
      ["for-each-ref", `--format=${REFS_TABLE_FORMAT}`, ...REFS_TABLE_PATTERNS],
      cwd
    );
    return parseRefsTable(output);
  } catch {
    return null;
  }
}

/** 当前分支的 upstream 是否已 gone。detached（branch null）恒 false。 */
export function upstreamGoneFor(
  table: RefsTable,
  branch: string | null
): boolean {
  if (branch === null || branch.length === 0) {
    return false;
  }
  const refname = `refs/heads/${branch}`;
  const entry = table.entries.find((e) => e.refname === refname);
  return entry?.track.includes("[gone]") ?? false;
}

/** 默认分支候选：remote-tracking tip（有 origin/HEAD 时）与同名本地分支 tip。 */
export interface DefaultBranchCandidate {
  /** 去掉 refs 前缀的分支名（如 `main`，保留带斜杠分支名）。 */
  branchName: string;
  oid: string;
  /** 完整 refname，供图查询命令引用。 */
  refname: string;
}

export interface DefaultBranchCandidates {
  local: DefaultBranchCandidate | null;
  remote: DefaultBranchCandidate | null;
}

/**
 * 从表中解析默认分支候选。remote：`refs/remotes/*​/HEAD` 的 symref target
 * （多远端 origin 优先）；local：与 remote 默认分支同名的 `refs/heads/<name>`
 * （覆盖"本地已合并、尚未 push"窗口期）。均解析不到时两者皆 null。
 */
export function defaultBranchCandidates(
  table: RefsTable
): DefaultBranchCandidates {
  let target: string | null = null;
  for (const entry of table.entries) {
    if (
      entry.symref.length === 0 ||
      !entry.symref.startsWith("refs/remotes/") ||
      !entry.refname.endsWith("/HEAD")
    ) {
      continue;
    }
    if (entry.refname === "refs/remotes/origin/HEAD") {
      target = entry.symref;
      break;
    }
    target ??= entry.symref;
  }
  if (target === null) {
    return { local: null, remote: null };
  }
  // refs/remotes/<remote>/<name...> → 前三段固定，其余为分支名
  const branchName = target.split("/").slice(3).join("/");
  const remoteEntry = table.entries.find((e) => e.refname === target);
  const localRef = `refs/heads/${branchName}`;
  const localEntry = table.entries.find((e) => e.refname === localRef);
  return {
    local:
      localEntry === undefined
        ? null
        : { branchName, oid: localEntry.oid, refname: localRef },
    remote:
      remoteEntry === undefined
        ? null
        : { branchName, oid: remoteEntry.oid, refname: target },
  };
}
