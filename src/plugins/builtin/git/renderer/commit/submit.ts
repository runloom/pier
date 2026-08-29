import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitRemoteOperationResult,
  GitStatus,
} from "@shared/contracts/git.ts";
import { pluginText } from "../plugin-text.ts";
import { getInFlightSync, trackSync } from "../sync-busy.ts";
import {
  type CommitCheckboxIntent,
  includeUnstagedChecked,
} from "./defaults.ts";
import {
  isWorkingTreeEmpty,
  resolveCommitPushAfter,
  unstagedChangeCount,
  unstagedPathsFromStatus,
} from "./paths.ts";

export class GitCommitMessageError extends Error {
  constructor() {
    super("commit message is required");
    this.name = "GitCommitMessageError";
  }
}

export type GitCommitBlockedKind = "empty" | "no-staged" | "paused";

export class GitCommitBlockedError extends Error {
  readonly kind: GitCommitBlockedKind;

  constructor(kind: GitCommitBlockedKind) {
    super(kind);
    this.name = "GitCommitBlockedError";
    this.kind = kind;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertRemoteOk(result: GitRemoteOperationResult): void {
  if (result.kind === "unavailable") {
    throw new Error(result.message ?? "git operation failed");
  }
}

async function alertPushFailed(
  context: RendererPluginContext,
  message: string
): Promise<void> {
  await context.dialogs.alert({
    body: pluginText(
      context,
      "gitCommitPushFailedBody",
      "{{message}}\n\nRetry push from the status bar.",
      { message }
    ),
    title: pluginText(
      context,
      "gitCommitPushFailed",
      "Committed, but couldn't push"
    ),
  });
}

async function pushAfterCommit(
  input: GitCommitSubmitInput,
  status: GitStatus
): Promise<void> {
  const wantPush = input.pushIntent ?? input.pushAfterPref;
  if (!wantPush) {
    return;
  }
  const pushAfter = resolveCommitPushAfter(status);
  if (pushAfter.action === null) {
    const reason =
      pushAfter.disabledReason === "auth"
        ? pluginText(
            input.context,
            "gitCommitPushAuth",
            "Sign in to the remote, then try again."
          )
        : pluginText(
            input.context,
            "gitCommitPushUnavailable",
            "Can't push to a remote right now."
          );
    await alertPushFailed(input.context, reason);
    return;
  }
  if (getInFlightSync(input.cwd)) {
    await alertPushFailed(
      input.context,
      pluginText(
        input.context,
        "statusSyncAlreadyRunning",
        "Sync already in progress"
      )
    );
    return;
  }
  try {
    await trackSync(input.cwd, async () => {
      const result =
        pushAfter.action === "push"
          ? await input.context.git.push(input.cwd)
          : await input.context.git.publish(input.cwd);
      assertRemoteOk(result);
    });
  } catch (error) {
    await alertPushFailed(input.context, errorMessage(error));
  }
}

export interface GitCommitSubmitInput {
  readonly context: RendererPluginContext;
  readonly cwd: string;
  readonly includeIntent: CommitCheckboxIntent;
  readonly message: string;
  readonly onCommitted?: () => void;
  readonly pushAfterPref: boolean;
  readonly pushIntent: CommitCheckboxIntent;
}

export async function submitGitCommit(
  input: GitCommitSubmitInput
): Promise<void> {
  const message = input.message.trim();
  if (message.length === 0) {
    throw new GitCommitMessageError();
  }
  const status = await input.context.git.getStatus(input.cwd);
  if (status.repoState.kind !== "clean") {
    throw new GitCommitBlockedError("paused");
  }
  if (isWorkingTreeEmpty(status)) {
    throw new GitCommitBlockedError("empty");
  }
  const includeUnstaged = includeUnstagedChecked(
    unstagedChangeCount(status),
    input.includeIntent
  );
  if (includeUnstaged) {
    const unstagedPaths = unstagedPathsFromStatus(status.files);
    if (unstagedPaths.length > 0) {
      await input.context.git.stage(input.cwd, [...unstagedPaths]);
    } else if (status.counts.staged === 0) {
      throw new GitCommitBlockedError("no-staged");
    }
  } else if (status.counts.staged === 0) {
    throw new GitCommitBlockedError("no-staged");
  }
  await input.context.git.commit(input.cwd, { message });
  input.onCommitted?.();
  await pushAfterCommit(input, status);
}
