import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  classifyGitRemoteFailure,
  type GitRemoteFailureKind,
} from "@shared/git-remote-failure.ts";
import { pluginText } from "./plugin-text.ts";

export type RemoteGitErrorKind = GitRemoteFailureKind;

/** Matches main `classifyRemoteGitError` summary prefixes (English, stable). */
const HOOK_SUMMARY_PREFIX =
  "A local git hook rejected or stopped this operation";
const TIMEOUT_SUMMARY_PREFIX =
  "git operation timed out (local checks or remote transfer may still be running)";

export interface RemoteOperationFailurePresentation {
  body: null | string;
  kind: RemoteGitErrorKind;
  title: string;
  /** true → host dialogs.alert; false → short toast (not message center). */
  useAlert: boolean;
}

export function classifyRemoteGitError(error: unknown): RemoteGitErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  return classifyGitRemoteFailure(message);
}

function rawErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim();
}

function stripSummaryPrefix(message: string, prefix: string): string {
  if (!message.startsWith(prefix)) {
    return message;
  }
  return message
    .slice(prefix.length)
    .replace(/^\s*\n+/, "")
    .trim();
}

function productBody(
  context: RendererPluginContext,
  kind: Exclude<RemoteGitErrorKind, "generic" | "hook" | "timeout">
): string {
  switch (kind) {
    case "noUpstream":
      return pluginText(
        context,
        "gitRemoteErrorNoUpstream",
        "This branch has no upstream yet. Publish the branch first, or fetch remote updates."
      );
    case "noRemote":
      return pluginText(
        context,
        "gitRemoteErrorNoRemote",
        "This repository has no remote configured. Add a remote before publishing."
      );
    case "auth":
      return pluginText(
        context,
        "gitRemoteErrorAuth",
        "Could not authenticate with the remote. Check your credentials or network access, then try again."
      );
    case "network":
      return pluginText(
        context,
        "gitRemoteErrorNetwork",
        "Could not reach the remote. Check your network connection and try again."
      );
    case "rejected":
      return pluginText(
        context,
        "gitRemoteErrorRejected",
        "The remote rejected the update. Fetch remote updates, then pull or sync before pushing again."
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function joinNextAndDetail(nextStep: string, detail: string): string {
  if (detail.length === 0) {
    return nextStep;
  }
  return `${nextStep}\n\n${detail}`;
}

/**
 * Present remote push/pull/sync failures for UI.
 * Hook / timeout / long technical errors → alert (title + body with detail).
 * Short product failures → toast only (user action feedback, not message center).
 */
export function remoteOperationFailurePresentation(
  context: RendererPluginContext,
  error: unknown
): RemoteOperationFailurePresentation {
  const kind = classifyRemoteGitError(error);
  const raw = rawErrorMessage(error);

  if (kind === "hook") {
    const detail = stripSummaryPrefix(raw, HOOK_SUMMARY_PREFIX);
    const nextStep = pluginText(
      context,
      "gitRemoteErrorHookNext",
      "Fix the check output below in a terminal, then try again."
    );
    return {
      body: joinNextAndDetail(nextStep, detail),
      kind,
      title: pluginText(
        context,
        "gitRemoteErrorHookTitle",
        "Project check script blocked this action"
      ),
      useAlert: true,
    };
  }

  if (kind === "timeout") {
    const detail = stripSummaryPrefix(raw, TIMEOUT_SUMMARY_PREFIX);
    const nextStep = pluginText(
      context,
      "gitRemoteErrorTimeout",
      "git ran longer than Pier allows for push, pull, or sync. This can be long local checks before push, or a stuck remote/network transfer. Check the network, run project checks in a terminal if needed, then try again."
    );
    return {
      body: joinNextAndDetail(nextStep, detail === nextStep ? "" : detail),
      kind,
      title: pluginText(
        context,
        "statusDropdownRemoteFailed",
        "Remote operation failed"
      ),
      useAlert: true,
    };
  }

  if (kind === "generic") {
    const useAlert =
      raw.length >= 160 || raw.includes("\n") || raw.includes("fatal:");
    if (useAlert) {
      return {
        body: raw.length > 0 ? raw : null,
        kind,
        title: pluginText(
          context,
          "statusDropdownRemoteFailed",
          "Remote operation failed"
        ),
        useAlert: true,
      };
    }
    return {
      body: null,
      kind,
      title: raw.length > 0 ? raw : "git operation failed",
      useAlert: false,
    };
  }

  return {
    body: null,
    kind,
    title: productBody(context, kind),
    useAlert: false,
  };
}

/** Toast-only string when callers still need a single line (prefer presentation). */
export function remoteOperationErrorBody(
  context: RendererPluginContext,
  error: unknown
): string {
  const presentation = remoteOperationFailurePresentation(context, error);
  if (presentation.body) {
    return `${presentation.title}\n\n${presentation.body}`;
  }
  return presentation.title;
}

/**
 * User-triggered remote failure feedback: alert with detail, or short error toast.
 * Never routes through the notification center / systemNotify.
 */
export function reportRemoteOperationFailure(
  context: RendererPluginContext,
  error: unknown
): Promise<void> {
  const presentation = remoteOperationFailurePresentation(context, error);
  if (presentation.useAlert) {
    return context.dialogs.alert({
      ...(presentation.body ? { body: presentation.body } : {}),
      title: presentation.title,
    });
  }
  context.notifications.error(presentation.title);
  return Promise.resolve();
}
