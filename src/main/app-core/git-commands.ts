import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";

/**
 * 分发 git.* 命令到 main 进程的 GitService。
 * 读命令需 git:read, 写命令需 git:write; 权限校验在 permissions.ts。
 */
export async function executeGitCommand(
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
    default:
      return null;
  }
}
