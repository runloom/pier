import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  classifyGitRemoteFailure,
  type GitRemoteFailureKind,
} from "@shared/git-remote-failure.ts";
import { pluginText } from "./plugin-text.ts";

export type RemoteGitErrorKind = GitRemoteFailureKind;

export function classifyRemoteGitError(error: unknown): RemoteGitErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  return classifyGitRemoteFailure(message);
}

/** 远程动作失败正文：优先产品文案，避免 man page 墙；generic 保留技术串。 */
export function remoteOperationErrorBody(
  context: RendererPluginContext,
  error: unknown
): string {
  const kind = classifyRemoteGitError(error);
  if (kind === "noUpstream") {
    return pluginText(
      context,
      "gitRemoteErrorNoUpstream",
      "This branch has no upstream yet. Publish the branch first, or fetch remote updates."
    );
  }
  if (kind === "noRemote") {
    return pluginText(
      context,
      "gitRemoteErrorNoRemote",
      "This repository has no remote configured. Add a remote before publishing."
    );
  }
  if (kind === "auth") {
    return pluginText(
      context,
      "gitRemoteErrorAuth",
      "Could not authenticate with the remote. Check your credentials or network access, then try again."
    );
  }
  if (kind === "network") {
    return pluginText(
      context,
      "gitRemoteErrorNetwork",
      "Could not reach the remote. Check your network connection and try again."
    );
  }
  if (kind === "rejected") {
    return pluginText(
      context,
      "gitRemoteErrorRejected",
      "The remote rejected the update. Fetch remote updates, then pull or sync before pushing again."
    );
  }
  if (kind === "timeout") {
    return pluginText(
      context,
      "gitRemoteErrorTimeout",
      "Git ran longer than Pier allows for push, pull, or sync. This can be long local checks before push, or a stuck remote/network transfer. Check the network, run project checks in a terminal if needed, then try again."
    );
  }
  if (kind === "hook") {
    return pluginText(
      context,
      "gitRemoteErrorHook",
      "A local Git hook rejected or stopped this operation. Open a terminal, fix the reported failure, then try again."
    );
  }
  return error instanceof Error ? error.message : String(error);
}
