import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type GitReviewConflictFileActionIntent,
  gitReviewConflictFileActions,
  gitReviewConflictPresentationSchema,
  gitReviewConflictXySchema,
  gitReviewFileSourceSchema,
  gitReviewRevisionSchema,
} from "@shared/contracts/git/review.ts";
import { pluginText } from "../plugin-text.ts";
import { reviewMutationFailureBody } from "./code-mutation-helpers.ts";
import { fileLevelConflictActionLabel } from "./document/conflict-file-level.tsx";
import type { GitReviewMutationAuthority } from "./mutation-authority.ts";

export const GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS = {
  "confirm-delete": "pier.git.review.resolveConflictDelete",
  "keep-deleted": "pier.git.review.resolveConflictKeepDeleted",
  "keep-current": "pier.git.review.resolveConflictKeepCurrent",
  "take-incoming": "pier.git.review.resolveConflictTakeIncoming",
  "stage-current": "pier.git.review.resolveConflictStageCurrent",
} as const;

function parseTarget(
  invocation: { metadata?: Record<string, unknown> } | undefined
) {
  const raw = invocation?.metadata?.conflict;
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const source = gitReviewFileSourceSchema.safeParse(value.source);
  const xy = gitReviewConflictXySchema.safeParse(value.xy);
  const presentation = gitReviewConflictPresentationSchema.safeParse(
    value.presentation
  );
  const digest = gitReviewRevisionSchema.safeParse(value.contentsDigest);
  if (
    !source.success ||
    source.data.target.kind !== "uncommitted" ||
    !xy.success ||
    !presentation.success ||
    !digest.success ||
    presentation.data === "markers-text" ||
    digest.data.startsWith("estimate:")
  )
    return null;
  return {
    source: source.data,
    xy: xy.data,
    presentation: presentation.data,
    contentsDigest: digest.data,
    readable: value.readable === true,
  };
}

function actionFor(
  invocation: { metadata?: Record<string, unknown> } | undefined,
  intent: GitReviewConflictFileActionIntent
) {
  const target = parseTarget(invocation);
  if (!target) return null;
  const spec = gitReviewConflictFileActions(target.xy).find(
    (candidate) => candidate.intent === intent
  );
  if (
    !spec ||
    (spec.action === "stage" &&
      !(target.presentation === "file-level" && target.readable))
  )
    return null;
  return { target, spec };
}

export function registerGitReviewDiffConflictActions(
  context: RendererPluginContext,
  authority: GitReviewMutationAuthority,
  surface: string
): () => void {
  const intents: readonly GitReviewConflictFileActionIntent[] = [
    "confirm-delete",
    "keep-deleted",
    "keep-current",
    "take-incoming",
    "stage-current",
  ];
  const disposers = intents.map((intent, sortOrder) =>
    context.actions.register({
      category: "git",
      id: GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS[intent],
      surfaces: [surface],
      enabled: (invocation) => {
        const resolved = actionFor(invocation, intent);
        return resolved !== null && !authority.blocked(resolved.target.source);
      },
      title: () => fileLevelConflictActionLabel(context, intent),
      metadata: {
        categoryKey: "git",
        group: "9_conflict",
        menuHidden: (invocation) => actionFor(invocation, intent) === null,
        sortOrder,
      },
      handler: async (invocation) => {
        const resolved = actionFor(invocation, intent);
        if (!resolved || authority.blocked(resolved.target.source)) return;
        const { target, spec } = resolved;
        try {
          if (
            spec.destructive &&
            !(await context.dialogs.confirm({
              body: target.source.path,
              confirmLabel: fileLevelConflictActionLabel(context, spec.intent),
              intent: "destructive",
              title: fileLevelConflictActionLabel(context, spec.intent),
            }))
          )
            return;
          // Confirmation can outlive another command: validate the target and lock again.
          if (
            !(actionFor(invocation, intent) && authority.acquire(target.source))
          )
            return;
          try {
            const result = await context.git.resolveReviewConflict({
              action: spec.action,
              expectedContentsDigest: target.contentsDigest,
              operationId: crypto.randomUUID(),
              source: target.source,
            });
            if (result.kind === "error")
              throw new Error(reviewMutationFailureBody(context, result));
          } finally {
            await authority.refreshAndRelease(target.source);
          }
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: pluginText(
              context,
              "reviewConflictResolveFailed",
              "Could not resolve conflict"
            ),
          });
        }
      },
    })
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}
