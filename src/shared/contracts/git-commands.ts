import { z } from "zod";
import {
  getFileContentOptionsSchema,
  gitCommitOptionsSchema,
  gitCreateBranchOptionsSchema,
  gitDeleteBranchOptionsSchema,
  gitDiffOptionsSchema,
  gitDiffSearchBranchesOptionsSchema,
  gitLogOptionsSchema,
  gitMergeOptionsSchema,
  gitPathsSchema,
  gitRebaseOptionsSchema,
  gitSearchCommitsOptionsSchema,
  gitSequencerOptionsSchema,
  gitStashOptionsSchema,
  gitStashPopOptionsSchema,
  listBranchesOptionsSchema,
} from "./git.ts";
import { gitReviewCommandSchemas } from "./git-review.ts";

// Git 只读底座命令（renderer/插件经 IPC 调用 main 的 GitService）
export const gitCommandSchemas = [
  z.object({ type: z.literal("git.getStatus"), cwd: z.string().min(1) }),
  ...gitReviewCommandSchemas,
  z.object({ type: z.literal("git.listIgnored"), cwd: z.string().min(1) }),
  z.object({ type: z.literal("git.getRepoInfo"), cwd: z.string().min(1) }),
  z.object({
    type: z.literal("git.isWorkingTreeClean"),
    cwd: z.string().min(1),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffText"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffSummary"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffPatch"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitLogOptionsSchema.optional(),
    type: z.literal("git.getLog"),
  }),
  z.object({
    cwd: z.string().min(1),
    oid: z.string().min(1),
    type: z.literal("git.getCommit"),
  }),
  z.object({
    cwd: z.string().min(1),
    oid: z.string().min(1),
    type: z.literal("git.getCommitPatch"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: getFileContentOptionsSchema,
    type: z.literal("git.getFileContent"),
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
  z.object({ type: z.literal("git.listTags"), cwd: z.string().min(1) }),
  z.object({
    cwd: z.string().min(1),
    ref: z.string().min(1),
    type: z.literal("git.resolveRef"),
  }),
  z.object({
    cwd: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("git.validateBranchName"),
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
