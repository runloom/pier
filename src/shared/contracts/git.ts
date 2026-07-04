import { z } from "zod";

/**
 * 单个变更文件的状态。
 * index/worktree 为 git porcelain 的 XY 状态码（如 "M"、"A"、"?"、"."）。
 * origPath 仅在重命名/复制时存在（指向旧路径）。
 */
export const gitFileStatusSchema = z.object({
  index: z.string(),
  origPath: z.string().nullable(),
  path: z.string(),
  worktree: z.string(),
});
export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;

/** 当前分支与上游的领先/落后信息。detached HEAD 时 branch 为 null；空仓库 oid 为 null。 */
export const gitBranchInfoSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
  branch: z.string().nullable(),
  /** HEAD 指向的 commit oid。空仓库为 null；detached 时用于渲染短 sha。 */
  oid: z.string().nullable(),
  upstream: z.string().nullable(),
  /** upstream 已配置但对端 ref 已删（`for-each-ref upstream:track` 含 `[gone]`）。 */
  upstreamGone: z.boolean(),
  /**
   * HEAD 是否已是默认分支 remote-tracking ref 的祖先（merge-base --is-ancestor）。
   * null = 不适用：detached / 无 origin/HEAD / 当前就在默认分支。
   * squash merge 检测不到（commit 被重写），是已知限制。
   */
  mergedIntoDefault: z.boolean().nullable(),
});
export type GitBranchInfo = z.infer<typeof gitBranchInfoSchema>;

/** 工作区文件类别聚合计数。避免 renderer 每次遍历 files 数组。 */
export const gitCountsSchema = z.object({
  conflict: z.number(),
  modified: z.number(),
  staged: z.number(),
  untracked: z.number(),
});
export type GitCounts = z.infer<typeof gitCountsSchema>;

/** 行级增删汇总（staged + unstaged）。binary 文件不计入。 */
export const gitDeltaSchema = z.object({
  deletions: z.number(),
  insertions: z.number(),
});
export type GitDelta = z.infer<typeof gitDeltaSchema>;

/**
 * 仓库特殊操作状态。检测方式：
 * - merging: `.git/MERGE_HEAD` 存在
 * - rebasing: `.git/rebase-merge/` 或 `.git/rebase-apply/` 存在；current/total 读 msgnum/end
 * - cherry-picking: `.git/CHERRY_PICK_HEAD` 存在
 * - reverting: `.git/REVERT_HEAD` 存在
 * - bisecting: `.git/BISECT_START` 存在；good/bad 从 BISECT_LOG 数
 *
 * 优先级（互斥）：bisecting > rebasing > merging > cherry-picking > reverting > clean。
 */
export const gitRepoStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clean") }),
  z.object({ conflictCount: z.number(), kind: z.literal("merging") }),
  z.object({
    conflictCount: z.number(),
    current: z.number(),
    kind: z.literal("rebasing"),
    total: z.number(),
  }),
  z.object({ conflictCount: z.number(), kind: z.literal("cherry-picking") }),
  z.object({ conflictCount: z.number(), kind: z.literal("reverting") }),
  z.object({ bad: z.number(), good: z.number(), kind: z.literal("bisecting") }),
]);
export type GitRepoState = z.infer<typeof gitRepoStateSchema>;

/**
 * 远端同步健康度（repo 级，autofetch 写入）。refs/remotes 是本地快照，
 * 此字段诚实标注快照年龄与同步暂停原因，避免 UI 把 behind=0 当实时事实。
 */
export const gitRemoteSyncSchema = z.object({
  /** 最近一次 fetch 成功的时间戳（ms）；从未成功为 null。 */
  lastSuccessAt: z.number().nullable(),
  state: z.enum(["idle", "fetching", "backoff", "authRequired"]),
});
export type GitRemoteSync = z.infer<typeof gitRemoteSyncSchema>;

/** 工作区整体状态：分支信息 + 变更文件列表 + 聚合派生字段。 */
export const gitStatusSchema = z.object({
  branch: gitBranchInfoSchema,
  counts: gitCountsSchema,
  /** null 表示 diff --numstat 失败（非致命）。 */
  delta: gitDeltaSchema.nullable(),
  files: z.array(gitFileStatusSchema),
  /** null = 该仓库尚无 autofetch 记录（禁用或未跑过）。 */
  remoteSync: gitRemoteSyncSchema.nullable(),
  repoState: gitRepoStateSchema,
  stashCount: z.number(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

/** 单文件的增删统计。binary 文件 insertions/deletions 记为 0。 */
export const gitDiffStatSchema = z.object({
  binary: z.boolean(),
  deletions: z.number(),
  insertions: z.number(),
  path: z.string(),
});
export type GitDiffStat = z.infer<typeof gitDiffStatSchema>;

/** 一组变更的增删汇总。 */
export const gitDiffSummarySchema = z.object({
  changed: z.number(),
  deletions: z.number(),
  files: z.array(gitDiffStatSchema),
  insertions: z.number(),
});
export type GitDiffSummary = z.infer<typeof gitDiffSummarySchema>;

/** 一条提交记录（精简字段）。 */
export const gitCommitSchema = z.object({
  author: z.string(),
  date: z.string(),
  hash: z.string(),
  message: z.string(),
});
export type GitCommit = z.infer<typeof gitCommitSchema>;

/** 仓库元信息。空仓库 headOid 为 null；origin/HEAD 缺失时 defaultBranch 为 null。 */
export const gitRepoInfoSchema = z.object({
  defaultBranch: z.string().nullable(),
  gitCommonDir: z.string(),
  /**
   * 本 worktree 的 gitDir（`.git` 指向的绝对路径）。
   * MERGE_HEAD / rebase-merge / CHERRY_PICK_HEAD / REVERT_HEAD / BISECT_START
   * 等操作状态文件都在 gitDir 下（per-worktree），而非 gitCommonDir 下。
   */
  gitDir: z.string(),
  gitRoot: z.string(),
  headOid: z.string().nullable(),
  isBare: z.boolean(),
  isWorktree: z.boolean(),
});
export type GitRepoInfo = z.infer<typeof gitRepoInfoSchema>;

/** 单个分支引用。kind 区分 local/remote。 */
export const gitBranchRefSchema = z.object({
  isCurrent: z.boolean(),
  kind: z.enum(["local", "remote"]),
  lastCommit: z.string(),
  name: z.string(),
  upstream: z.string().nullable(),
});
export type GitBranchRef = z.infer<typeof gitBranchRefSchema>;

export const gitDiffBranchOptionSchema = z.object({
  aheadFromCurrent: z.number().int().nonnegative().nullable(),
  authorName: z.string().nullable(),
  behindFromCurrent: z.number().int().nonnegative().nullable(),
  commit: z.string().nullable(),
  committerDate: z.string().nullable(),
  current: z.boolean(),
  id: z.string(),
  kind: z.enum(["local", "remote"]),
  label: z.string(),
  name: z.string(),
  pinReason: z.enum(["default"]).nullable(),
  refName: z.string(),
  subject: z.string().nullable(),
});
export type GitDiffBranchOption = z.infer<typeof gitDiffBranchOptionSchema>;

export const gitDiffBranchesResultSchema = z.object({
  currentBranch: z.string().nullable(),
  durationMs: z.number().nonnegative(),
  items: z.array(gitDiffBranchOptionSchema),
  message: z.string().nullable(),
  status: z.enum(["ok", "timeout", "error"]),
});
export type GitDiffBranchesResult = z.infer<typeof gitDiffBranchesResultSchema>;

/** unified diff 中单行：context/add/del 三种 kind 之一。 */
export const gitDiffLineSchema = z.object({
  kind: z.enum(["context", "add", "del"]),
  text: z.string(),
});
export type GitDiffLine = z.infer<typeof gitDiffLineSchema>;

/** 一个 hunk：@@ -oldStart,oldLines +newStart,newLines @@ 起头，跟若干 lines。 */
export const gitDiffHunkSchema = z.object({
  lines: z.array(gitDiffLineSchema),
  newLines: z.number(),
  newStart: z.number(),
  oldLines: z.number(),
  oldStart: z.number(),
});
export type GitDiffHunk = z.infer<typeof gitDiffHunkSchema>;

/** 单文件 patch。binary 文件无 hunks。 */
export const gitDiffFilePatchSchema = z.object({
  binary: z.boolean(),
  hunks: z.array(gitDiffHunkSchema),
  oldPath: z.string().nullable(),
  path: z.string(),
});
export type GitDiffFilePatch = z.infer<typeof gitDiffFilePatchSchema>;

/** 完整 patch：多文件 file patches 的集合。 */
export const gitDiffPatchSchema = z.object({
  files: z.array(gitDiffFilePatchSchema),
});
export type GitDiffPatch = z.infer<typeof gitDiffPatchSchema>;

/** diff 选项的 IPC schema（main 收到 renderer 命令时校验）。 */
export const gitDiffOptionsSchema = z.object({
  from: z.string().optional(),
  paths: z.array(z.string()).optional(),
  staged: z.boolean().optional(),
  to: z.string().optional(),
});

export const gitLogOptionsSchema = z.object({
  author: z.string().optional(),
  grep: z.string().optional(),
  maxCount: z.number().int().positive().optional(),
  path: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});

export const listBranchesOptionsSchema = z.object({
  kind: z.enum(["all", "local", "remote"]),
});

export const gitDiffSearchBranchesOptionsSchema = z.object({
  currentBranch: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  query: z.string().max(512).optional(),
});

export const getFileContentOptionsSchema = z.object({
  path: z.string(),
  ref: z.string().optional(),
});

/** paths 必须非空数组,避免 `git add` / `git restore` 无意中作用于所有文件。 */
export const gitPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});

export const gitCommitOptionsSchema = z.object({
  allowEmpty: z.boolean().optional(),
  message: z.string().min(1),
  signoff: z.boolean().optional(),
});

export const gitCreateBranchOptionsSchema = z.object({
  name: z.string().min(1),
  startPoint: z.string().min(1).optional(),
});

export const gitDeleteBranchOptionsSchema = z.object({
  force: z.boolean().optional(),
  name: z.string().min(1),
});

export const gitMergeOptionsSchema = z.object({
  branch: z.string().min(1),
});

const gitUnavailableResultSchema = z.object({
  kind: z.literal("unavailable"),
  message: z.string().nullable(),
});

export const gitMergeResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), message: z.string() }),
  z.object({ kind: z.literal("already_up_to_date") }),
  z.object({ conflictCount: z.number(), kind: z.literal("conflict") }),
  gitUnavailableResultSchema,
]);
export type GitMergeResult = z.infer<typeof gitMergeResultSchema>;

export const gitMergeAbortResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  gitUnavailableResultSchema,
]);
export type GitMergeAbortResult = z.infer<typeof gitMergeAbortResultSchema>;

export const gitStashOptionsSchema = z.object({
  includeUntracked: z.boolean().optional(),
  message: z.string().optional(),
});

export const gitStashResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("nothing_to_stash") }),
  gitUnavailableResultSchema,
]);
export type GitStashResult = z.infer<typeof gitStashResultSchema>;

export const gitStashEntrySchema = z.object({
  date: z.string(),
  hash: z.string(),
  index: z.number().int().min(0),
  message: z.string(),
});
export type GitStashEntry = z.infer<typeof gitStashEntrySchema>;

export const gitStashListResultSchema = z.discriminatedUnion("kind", [
  z.object({ entries: z.array(gitStashEntrySchema), kind: z.literal("ok") }),
  gitUnavailableResultSchema,
]);
export type GitStashListResult = z.infer<typeof gitStashListResultSchema>;

export const gitStashPopOptionsSchema = z.object({
  index: z.number().int().min(0).optional(),
});

export const gitStashPopResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("conflict") }),
  gitUnavailableResultSchema,
]);
export type GitStashPopResult = z.infer<typeof gitStashPopResultSchema>;

export const gitRebaseOptionsSchema = z.object({
  branch: z.string().min(1),
});

export const gitRebaseResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), message: z.string() }),
  z.object({ kind: z.literal("already_up_to_date") }),
  z.object({ kind: z.literal("conflict"), message: z.string() }),
  gitUnavailableResultSchema,
]);
export type GitRebaseResult = z.infer<typeof gitRebaseResultSchema>;

export const gitRebaseAbortResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  gitUnavailableResultSchema,
]);
export type GitRebaseAbortResult = z.infer<typeof gitRebaseAbortResultSchema>;

export const gitRebaseContinueResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), message: z.string() }),
  z.object({ kind: z.literal("conflict"), message: z.string() }),
  gitUnavailableResultSchema,
]);
export type GitRebaseContinueResult = z.infer<
  typeof gitRebaseContinueResultSchema
>;

export const gitUndoCommitResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("nothing_to_undo") }),
  gitUnavailableResultSchema,
]);
export type GitUndoCommitResult = z.infer<typeof gitUndoCommitResultSchema>;

/**
 * 变更监听广播事件。changeKind 区分工作区/HEAD/纯 ref/组合变化。
 * "refs" 仅在 refs 是唯一变化类别时上报（fetch/push/prune/stash 等纯 ref 操作）；
 * 与 worktree/head 同时变化时沿用原有三值。
 */
export const gitChangeKindSchema = z.enum(["worktree", "head", "both", "refs"]);
export const gitChangeEventSchema = z.object({
  changeKind: gitChangeKindSchema,
  gitRoot: z.string(),
  /**
   * 广播时同步下发的最新 status snapshot。多个 renderer 订阅者共享同一份，
   * 免除各自重新 IPC 拉取 + 消除 out-of-order fetch 竞态。
   * 首次订阅（无广播）时 renderer 走 getStatus 拉初值。
   */
  status: gitStatusSchema.optional(),
});
export type GitChangeKind = z.infer<typeof gitChangeKindSchema>;
export type GitChangeEvent = z.infer<typeof gitChangeEventSchema>;
