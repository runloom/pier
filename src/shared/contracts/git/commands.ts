import { z } from "zod";
import {
  gitCommitOptionsSchema,
  gitCreateBranchOptionsSchema,
  gitDeleteBranchOptionsSchema,
  gitDiffOptionsSchema,
  gitDiffSearchBranchesOptionsSchema,
  gitMergeOptionsSchema,
  gitPathsSchema,
  gitRebaseOptionsSchema,
  gitSearchCommitsOptionsSchema,
  gitSequencerOptionsSchema,
  gitStashOptionsSchema,
  gitStashPopOptionsSchema,
  listBranchesOptionsSchema,
} from "../git.ts";
import { gitFileBaselineInputSchema } from "./file-baseline.ts";
import { gitReviewCommandSchemas } from "./review.ts";

// Git 只读底座命令（renderer/插件经 IPC 调用 main 的 GitService）
export const gitCommandSchemas = [
  gitFileBaselineInputSchema.extend({ type: z.literal("git.getFileBaseline") }),
  z.object({ type: z.literal("git.getStatus"), cwd: z.string().min(1) }),
  /**
   * 在桌面工作区打开（或聚焦）该仓库的审查面板（show-or-focus，与桌面
   * 状态栏/命令面板同语义）。移动端 S2 入口经此命令与 PC 同步打开。
   */
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.openReviewPanel"),
    windowId: z.string().min(1).optional(),
  }),
  ...gitReviewCommandSchemas,
  z.object({ type: z.literal("git.listIgnored"), cwd: z.string().min(1) }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffPatch"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: listBranchesOptionsSchema,
    type: z.literal("git.listBranches"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffSearchBranchesOptionsSchema.optional(),
    type: z.literal("git.searchBranches"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitSearchCommitsOptionsSchema.optional(),
    type: z.literal("git.searchCommits"),
  }),
  // Git 写命令(需 git:write capability)
  gitPathsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stage"),
  }),
  gitPathsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.unstage"),
  }),

  gitPathsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.discardChanges"),
  }),

  gitCommitOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.commit"),
  }),
  gitCreateBranchOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.createBranch"),
  }),
  z.object({
    cwd: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("git.createAndSwitchBranch"),
  }),
  gitDeleteBranchOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.deleteBranch"),
  }),
  z.object({
    cwd: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("git.checkoutBranch"),
  }),
  gitMergeOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.merge"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.mergeAbort"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.push"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.publish"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.fetch"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.pullFastForward"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.sync"),
  }),
  gitStashOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stash"),
  }),
  gitStashPopOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stashPop"),
  }),
  gitStashPopOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stashApply"),
  }),
  gitStashPopOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stashDrop"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.stashList"),
  }),
  gitRebaseOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.rebase"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.rebaseAbort"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.rebaseContinue"),
  }),
  gitSequencerOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.cherryPick"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.cherryPickAbort"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.cherryPickContinue"),
  }),
  gitSequencerOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.revert"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.revertAbort"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.revertContinue"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.undoLastCommit"),
  }),
] as const;
