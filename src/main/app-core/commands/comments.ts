import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { CommandExecutionContext } from "../command-execution-context.ts";
import { commandSuccess as success } from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

type CommentsCommandType = Extract<
  PierCommand,
  {
    type:
      | "comments.list"
      | "comments.listProjects"
      | "comments.createThread"
      | "comments.updateComment"
      | "comments.deleteComment";
  }
>["type"];

const COMMENTS_COMMAND_TYPES: ReadonlySet<string> =
  new Set<CommentsCommandType>([
    "comments.list",
    "comments.listProjects",
    "comments.createThread",
    "comments.updateComment",
    "comments.deleteComment",
  ]);

function isCommentsCommand(
  command: PierCommand
): command is Extract<PierCommand, { type: CommentsCommandType }> {
  return COMMENTS_COMMAND_TYPES.has(command.type);
}

/**
 * 评论命令执行器（设计文档 §3、§6）。
 *
 * 经 command-router executors 数组顺序匹配：返回 null 表示不归本执行器，
 * 非 null 表示已处理。capability 已由 authorizeCommand 在路由前校验
 * （comments:read / comments:write），这里只做业务分派。
 *
 * v1 瘦身：只分派 list / listProjects / createThread / updateComment /
 * deleteComment。
 */
export async function executeCommentsCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  _context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  if (!isCommentsCommand(command)) {
    return null;
  }
  const comments = services.comments;
  switch (command.type) {
    case "comments.list":
      return success(requestId, await comments.list(command.request));
    case "comments.listProjects":
      return success(requestId, await comments.listProjects(command.request));
    case "comments.createThread":
      return success(requestId, await comments.createThread(command.request));
    case "comments.updateComment":
      return success(requestId, await comments.updateComment(command.request));
    case "comments.deleteComment":
      return success(requestId, await comments.deleteComment(command.request));
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
