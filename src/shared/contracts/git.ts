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

/** 当前分支与上游的领先/落后信息。detached HEAD 时 branch 为 null。 */
export const gitBranchInfoSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
});
export type GitBranchInfo = z.infer<typeof gitBranchInfoSchema>;

/** 工作区整体状态：分支信息 + 变更文件列表。 */
export const gitStatusSchema = z.object({
  branch: gitBranchInfoSchema,
  files: z.array(gitFileStatusSchema),
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

/** 变更监听广播事件。changeKind 区分工作区/HEAD/二者同时变化。 */
export const gitChangeKindSchema = z.enum(["worktree", "head", "both"]);
export const gitChangeEventSchema = z.object({
  changeKind: gitChangeKindSchema,
  gitRoot: z.string(),
});
export type GitChangeKind = z.infer<typeof gitChangeKindSchema>;
export type GitChangeEvent = z.infer<typeof gitChangeEventSchema>;
