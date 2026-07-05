import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";

/**
 * 写操作命令表：执行成功后立即 pulse watch service（业界惯例：应用自己跑完
 * git 命令即时刷新，不等 fs 事件/poll——linked worktree 的元数据事件在
 * commonDir，post-op pulse 是最低延迟的第一信号源）。
 */
const GIT_WRITE_COMMANDS: Record<string, true> = {
  "git.checkoutBranch": true,
  "git.commit": true,
  "git.createBranch": true,
  "git.deleteBranch": true,
  "git.discardChanges": true,
  "git.merge": true,
  "git.mergeAbort": true,
  "git.rebase": true,
  "git.rebaseAbort": true,
  "git.rebaseContinue": true,
  "git.stage": true,
  "git.stash": true,
  "git.stashPop": true,
  "git.undoLastCommit": true,
  "git.unstage": true,
};

/**
 * 分发 git.* 命令到 main 进程的 GitService。
 * 读命令需 git:read, 写命令需 git:write; 权限校验在 permissions.ts。
 */
export async function executeGitCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  const result = await dispatchGitCommand(requestId, command, services);
  if (
    result !== null &&
    GIT_WRITE_COMMANDS[command.type] === true &&
    "cwd" in command &&
    typeof command.cwd === "string"
  ) {
    // 有冲突/中止等非 ok 结果也 pulse：MERGE_HEAD 等状态已变，UI 需要立刻看到
    services.gitWatch.pulse(command.cwd);
  }
  return result;
}

async function dispatchGitCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "git.getStatus":
      return success(requestId, await services.git.getStatus(command.cwd));
    case "git.getRepoInfo":
      return success(requestId, await services.git.getRepoInfo(command.cwd));
    case "git.isWorkingTreeClean":
      return success(
        requestId,
        await services.git.isWorkingTreeClean(command.cwd)
      );
    case "git.getDiffText":
      return success(
        requestId,
        await services.git.getDiffText(command.cwd, command.options)
      );
    case "git.getDiffSummary":
      return success(
        requestId,
        await services.git.getDiffSummary(command.cwd, command.options)
      );
    case "git.getDiffPatch":
      return success(
        requestId,
        await services.git.getDiffPatch(command.cwd, command.options)
      );
    case "git.getLog":
      return success(
        requestId,
        await services.git.getLog(command.cwd, command.options)
      );
    case "git.getCommit":
      return success(
        requestId,
        await services.git.getCommit(command.cwd, command.oid)
      );
    case "git.getCommitPatch":
      return success(
        requestId,
        await services.git.getCommitPatch(command.cwd, command.oid)
      );
    case "git.getFileContent":
      return success(
        requestId,
        await services.git.getFileContent(command.cwd, command.options)
      );
    case "git.listBranches":
      return success(
        requestId,
        await services.git.listBranches(command.cwd, command.options)
      );
    case "git.searchBranches":
      return success(
        requestId,
        await services.git.searchBranches(command.cwd, command.options)
      );
    case "git.listTags":
      return success(requestId, await services.git.listTags(command.cwd));
    case "git.resolveRef":
      return success(
        requestId,
        await services.git.resolveRef(command.cwd, command.ref)
      );
    case "git.validateBranchName":
      return success(
        requestId,
        await services.git.validateBranchName(command.cwd, command.name)
      );
    case "git.stage":
      await services.git.stage(command.cwd, { paths: command.paths });
      return success(requestId, true);
    case "git.unstage":
      await services.git.unstage(command.cwd, { paths: command.paths });
      return success(requestId, true);
    case "git.discardChanges":
      await services.git.discardChanges(command.cwd, {
        paths: command.paths,
      });
      return success(requestId, true);
    // 以下写命令当前无 renderer/插件消费方,保留给 CLI/未来表面;授权由 permissions.ts 按 client capability 把门
    case "git.commit":
      await services.git.commit(command.cwd, {
        ...(command.allowEmpty !== undefined && {
          allowEmpty: command.allowEmpty,
        }),
        message: command.message,
        ...(command.signoff !== undefined && { signoff: command.signoff }),
      });
      return success(requestId, true);
    case "git.createBranch":
      await services.git.createBranch(command.cwd, {
        name: command.name,
        ...(command.startPoint !== undefined && {
          startPoint: command.startPoint,
        }),
      });
      return success(requestId, true);
    case "git.deleteBranch":
      await services.git.deleteBranch(command.cwd, {
        ...(command.force !== undefined && { force: command.force }),
        name: command.name,
      });
      return success(requestId, true);
    case "git.checkoutBranch":
      await services.git.checkoutBranch(command.cwd, command.name);
      return success(requestId, true);
    case "git.merge":
      return success(
        requestId,
        await services.git.merge(command.cwd, command.branch)
      );
    case "git.mergeAbort":
      return success(requestId, await services.git.abortMerge(command.cwd));
    case "git.stash":
      return success(
        requestId,
        await services.git.stash(command.cwd, {
          ...(command.includeUntracked !== undefined && {
            includeUntracked: command.includeUntracked,
          }),
          ...(command.message !== undefined && { message: command.message }),
        })
      );
    case "git.stashPop":
      return success(
        requestId,
        await services.git.popStash(command.cwd, command.index)
      );
    case "git.stashList":
      return success(requestId, await services.git.listStashes(command.cwd));
    case "git.rebase":
      return success(
        requestId,
        await services.git.rebase(command.cwd, command.branch)
      );
    case "git.rebaseAbort":
      return success(requestId, await services.git.abortRebase(command.cwd));
    case "git.rebaseContinue":
      return success(requestId, await services.git.continueRebase(command.cwd));
    case "git.undoLastCommit":
      return success(requestId, await services.git.undoLastCommit(command.cwd));
    default:
      return null;
  }
}
