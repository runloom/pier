import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  type GitReviewFailure,
  type GitReviewScope,
  gitReviewFailureSchema,
} from "@shared/contracts/git-review.ts";
import {
  GIT_REVIEW_DEADLINE_MS,
  GitReviewBudget,
} from "../services/git-review/git-review-budget.ts";
import { raceGitReviewIdentityBoundary } from "../services/git-review/git-review-identity-boundary.ts";
import { toGitReviewIndexFailure } from "../services/git-review/git-review-index-execution.ts";
import type {
  GitReviewExecutionBudget,
  GitReviewOperationOwner,
} from "../services/git-review/git-review-scheduler.ts";
import type { CommandExecutionContext } from "./command-execution-context.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeGitReviewCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  if (!isGitReviewCommand(command)) {
    return null;
  }
  const owner = ownerFromContext(context);
  if (owner === null) {
    return success(
      requestId,
      failure("invalidSource", false, "Git Review 请求缺少可信窗口身份")
    );
  }
  if (command.type === "git.cancelReviewRequest") {
    services.gitReview.cancelReviewRequest(command.request, owner);
    return success(requestId, null);
  }
  const budget = new GitReviewBudget({
    deadlineAtMs:
      (context.requestStartedAtMs ?? Date.now()) + GIT_REVIEW_DEADLINE_MS,
  });
  const options = {
    budget,
    owner,
    resolveSource: <T extends GitReviewScope>(
      source: T,
      control: {
        budget: GitReviewExecutionBudget;
        signal: AbortSignal;
      }
    ) => canonicalSource(source, services, control),
  };
  switch (command.type) {
    case "git.getReviewIndex": {
      return success(
        requestId,
        await services.gitReview.getIndex(command.request, options)
      );
    }
    case "git.getReviewFileDocument": {
      return success(
        requestId,
        await services.gitReview.getFileDocument(command.request, options)
      );
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

function isGitReviewCommand(command: PierCommand): command is Extract<
  PierCommand,
  {
    type:
      | "git.cancelReviewRequest"
      | "git.getReviewFileDocument"
      | "git.getReviewIndex";
  }
> {
  return (
    command.type === "git.cancelReviewRequest" ||
    command.type === "git.getReviewFileDocument" ||
    command.type === "git.getReviewIndex"
  );
}

async function canonicalSource<T extends GitReviewScope>(
  source: T,
  services: PierCoreServices,
  control: {
    budget: GitReviewExecutionBudget;
    signal: AbortSignal;
  }
): Promise<GitReviewFailure | { kind: "ok"; value: T }> {
  try {
    const context = await raceGitReviewIdentityBoundary(
      () =>
        services.panelContexts.resolveForPath(source.gitRootPath, {
          budget: control.budget,
          signal: control.signal,
        }),
      control
    );
    if (
      context.contextId !== source.contextId ||
      context.gitRoot === undefined
    ) {
      return failure("invalidSource", false, "Git Review 工作区身份不匹配");
    }
    return {
      kind: "ok",
      value: { ...source, gitRootPath: context.gitRoot },
    };
  } catch (error) {
    return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
  }
}

function ownerFromContext(
  context: CommandExecutionContext
): GitReviewOperationOwner | null {
  if (
    context.clientId === undefined ||
    context.navigationGeneration === undefined ||
    context.webContentsId === undefined ||
    context.windowRecordId === undefined
  ) {
    return null;
  }
  return {
    clientId: context.clientId,
    generation: context.navigationGeneration,
    windowRecordId: `${context.windowRecordId}:webContents:${context.webContentsId}`,
  };
}

function failure(
  reason: GitReviewFailure["reason"],
  retryable: boolean,
  message: string
): GitReviewFailure {
  return gitReviewFailureSchema.parse({
    kind: "error",
    message,
    reason,
    retryable,
  });
}
