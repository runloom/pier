import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewFailureReason,
  GitReviewWarning,
} from "@shared/contracts/git-review.ts";
import { pluginText } from "./git-plugin-text.ts";

const FAILURE_TEXT = {
  aborted: {
    fallback: "The request was cancelled.",
    key: "reviewFailureAborted",
  },
  busy: {
    fallback: "Git review is busy. Try again.",
    key: "reviewFailureBusy",
  },
  commandFailed: {
    fallback: "Git could not read this change.",
    key: "reviewFailureCommandFailed",
  },
  duplicateOperation: {
    fallback: "This review request is already running.",
    key: "reviewFailureDuplicateOperation",
  },
  internal: {
    fallback: "An internal error occurred while reading the change.",
    key: "reviewFailureInternal",
  },
  invalidSource: {
    fallback: "The Git review source is no longer valid.",
    key: "reviewFailureInvalidSource",
  },
  notRepository: {
    fallback: "This directory is no longer a Git repository.",
    key: "reviewFailureNotRepository",
  },
  outputLimit: {
    fallback: "The change exceeds the review size limit.",
    key: "reviewFailureOutputLimit",
  },
  staleRevision: {
    fallback: "The change kept updating. Try again.",
    key: "reviewFailureStaleRevision",
  },
  timeout: {
    fallback: "Reading the change timed out.",
    key: "reviewFailureTimeout",
  },
} as const satisfies Record<
  GitReviewFailureReason,
  { fallback: string; key: string }
>;

export function gitReviewFailureMessage(
  context: RendererPluginContext,
  failure: GitReviewFailure
): string {
  const text = FAILURE_TEXT[failure.reason];
  return pluginText(context, text.key, text.fallback);
}

export function gitReviewWarningMessage(
  context: RendererPluginContext,
  warning: GitReviewWarning
): string {
  if (warning.code === "pathDepthExceeded") {
    return pluginText(
      context,
      "reviewWarningPathDepthExceeded",
      "{{skipped}} paths exceeded the supported directory depth and were skipped.",
      { skipped: warning.skipped }
    );
  }
  if (warning.code === "invalidPathEncoding") {
    return pluginText(
      context,
      "reviewWarningInvalidPathEncoding",
      "{{skipped}} paths could not be decoded and were skipped.",
      { skipped: warning.skipped }
    );
  }
  const exhaustive: never = warning;
  return exhaustive;
}
