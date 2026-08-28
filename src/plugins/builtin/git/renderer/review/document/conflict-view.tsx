import { Button } from "@pier/ui/button.tsx";
import type {
  PierDiffViewAppearance,
  PierDiffViewItem,
  PierDiffViewPresentation,
  PierUnresolvedConflictLabels,
} from "@pier/ui/diff-view/index.tsx";
import {
  PierDiffWorkerProvider,
  PierUnresolvedConflictView,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type GitReviewConflictFileActionIntent,
  type GitReviewFileSource,
  type GitReviewMutationOk,
  gitReviewConflictCanOpen,
  gitReviewConflictFileActions,
} from "@shared/contracts/git/review.ts";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { pluginText } from "../../plugin-text.ts";
import { openGitReviewPathInEditor } from "../diff-actions.ts";

function fileLevelActionLabel(
  context: RendererPluginContext,
  intent: GitReviewConflictFileActionIntent
): string {
  switch (intent) {
    case "confirm-delete":
      return pluginText(
        context,
        "reviewConflictConfirmDelete",
        "Confirm Delete"
      );
    case "keep-current":
      return pluginText(
        context,
        "reviewConflictKeepCurrent",
        "Keep Current File"
      );
    case "keep-deleted":
      return pluginText(context, "reviewConflictKeepDeleted", "Keep Deleted");
    case "stage-current":
      return pluginText(
        context,
        "reviewConflictStageCurrent",
        "Stage Current File"
      );
    case "take-incoming":
      return pluginText(
        context,
        "reviewConflictTakeIncoming",
        "Use Incoming Version"
      );
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
}

function openIsPrimaryPresentation(
  presentation: NonNullable<PierDiffViewItem["conflict"]>["presentation"]
): boolean {
  return (
    presentation === "tooLarge" ||
    presentation === "invalidEncoding" ||
    presentation === "readError"
  );
}

/** UnresolvedFile host for markers-text; file-level ours/theirs/stage notice. */
export function ReviewConflictView(options: {
  readonly appearance: PierDiffViewAppearance;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly items: readonly PierDiffViewItem[];
  readonly mutationBlocked: boolean;
  readonly onMutationCommitted: (
    result: GitReviewMutationOk | null
  ) => Promise<void>;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement {
  const {
    appearance,
    context,
    contextId,
    gitRootPath,
    items,
    mutationBlocked,
    onMutationCommitted,
    presentation,
  } = options;
  const [busyId, setBusyId] = useState<string | null>(null);
  const item = items[0];

  const labels = useMemo(
    (): PierUnresolvedConflictLabels => ({
      acceptBoth: pluginText(
        context,
        "reviewConflictAcceptBoth",
        "Accept Both Changes"
      ),
      acceptCurrent: pluginText(
        context,
        "reviewConflictAcceptCurrent",
        "Accept Current Change"
      ),
      acceptIncoming: pluginText(
        context,
        "reviewConflictAcceptIncoming",
        "Accept Incoming Change"
      ),
      currentChange: pluginText(
        context,
        "reviewConflictCurrentChange",
        "(Current Change)"
      ),
      expandAllUnmodified: pluginText(
        context,
        "reviewExpandAllUnmodified",
        "Expand all"
      ),
      incomingChange: pluginText(
        context,
        "reviewConflictIncomingChange",
        "(Incoming Change)"
      ),
      openFile: pluginText(context, "reviewOpenFile", "Open File"),
      resolving: pluginText(context, "reviewConflictResolving", "Resolving…"),
      unmodifiedLine: pluginText(
        context,
        "reviewUnmodifiedLine",
        "{{count}} unmodified line"
      ),
      unmodifiedLines: pluginText(
        context,
        "reviewUnmodifiedLines",
        "{{count}} unmodified lines"
      ),
    }),
    [context]
  );

  const sourceFor = useCallback(
    (path: string): GitReviewFileSource => ({
      contextId,
      gitRootPath,
      oldPaths: [],
      path,
      target: { kind: "uncommitted" },
    }),
    [contextId, gitRootPath]
  );

  const alertResolveFailed = useCallback(
    async (error: unknown) => {
      await context.dialogs.alert({
        body: error instanceof Error ? error.message : String(error),
        title: pluginText(
          context,
          "reviewConflictResolveFailed",
          "Could not resolve conflict"
        ),
      });
    },
    [context]
  );

  /** Throws on failure so marker write-back can remount Accept UI. */
  const writeResolved = useCallback(
    async (target: PierDiffViewItem, resolvedContents: string) => {
      const path = target.fileDisplay?.path;
      const conflict = target.conflict;
      if (!path || conflict === undefined) {
        return;
      }
      setBusyId(target.id);
      try {
        const result = await context.git.resolveReviewConflict({
          action: "write",
          expectedContentsDigest: conflict.contentsDigest,
          operationId: crypto.randomUUID(),
          resolvedContents,
          source: sourceFor(path),
        });
        if (result.kind === "error") {
          throw new Error(result.message ?? result.reason);
        }
        await onMutationCommitted(result);
      } finally {
        setBusyId(null);
      }
    },
    [context, onMutationCommitted, sourceFor]
  );

  const resolveSide = useCallback(
    async (target: PierDiffViewItem, action: "ours" | "stage" | "theirs") => {
      const path = target.fileDisplay?.path;
      if (!path) {
        return;
      }
      setBusyId(target.id);
      try {
        const result = await context.git.resolveReviewConflict({
          action,
          operationId: crypto.randomUUID(),
          source: sourceFor(path),
        });
        if (result.kind === "error") {
          throw new Error(result.message ?? result.reason);
        }
        await onMutationCommitted(result);
      } catch (error) {
        await alertResolveFailed(error);
      } finally {
        setBusyId(null);
      }
    },
    [alertResolveFailed, context, onMutationCommitted, sourceFor]
  );

  let focused: ReactElement | null = null;
  if (item !== undefined && item.conflict !== undefined) {
    if (
      item.conflict.presentation === "markers-text" &&
      item.conflict.contents !== null
    ) {
      focused = (
        <div className="min-h-0 flex-1" data-git-review-conflict-item={item.id}>
          <PierUnresolvedConflictView
            appearance={appearance}
            busy={mutationBlocked || busyId === item.id}
            conflict={item.conflict}
            labels={labels}
            onError={(error) => {
              alertResolveFailed(error).catch(() => undefined);
            }}
            onOpenFile={() => {
              openGitReviewPathInEditor({
                context,
                contextId,
                gitRootPath,
                path: item.fileDisplay?.path ?? item.id,
              });
            }}
            onWriteResolved={({ contents }) => writeResolved(item, contents)}
            path={item.fileDisplay?.path ?? item.id}
            {...(presentation === undefined ? {} : { presentation })}
          />
        </div>
      );
    } else {
      focused = (
        <FileLevelConflictCard
          busy={
            mutationBlocked ||
            busyId === item.id ||
            item.conflict.contentsDigest.startsWith("estimate:")
          }
          context={context}
          contextId={contextId}
          gitRootPath={gitRootPath}
          item={item}
          onResolve={(action) => {
            resolveSide(item, action).catch(() => undefined);
          }}
          openLabel={labels.openFile}
        />
      );
    }
  }

  return (
    <PierDiffWorkerProvider
      onError={(error) => {
        console.error(error);
      }}
      onUnavailable={() => {
        // Plain-text + color-scheme fallback still works without workers.
      }}
      theme={appearance.codeThemes}
    >
      <div
        className="flex h-full min-h-0 min-w-0 flex-col"
        data-git-review-conflict-view=""
      >
        {focused}
      </div>
    </PierDiffWorkerProvider>
  );
}

function FileLevelConflictCard(options: {
  readonly busy: boolean;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly item: PierDiffViewItem;
  readonly onResolve: (action: "ours" | "stage" | "theirs") => void;
  readonly openLabel: string;
}): ReactElement | null {
  const { busy, context, contextId, gitRootPath, item, onResolve, openLabel } =
    options;
  const conflict = item.conflict;
  const path = item.fileDisplay?.path ?? item.id;
  if (conflict === undefined) {
    return null;
  }
  const canOpen = gitReviewConflictCanOpen(conflict.xy);
  const openPrimary = openIsPrimaryPresentation(conflict.presentation);
  const showOpen = canOpen || openPrimary;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 p-5"
      data-git-review-conflict-file-level={item.id}
    >
      <div className="min-w-0">
        <div className="truncate text-sm">{path}</div>
        {item.stateNotice === undefined ? null : (
          <p className="text-muted-foreground text-sm">{item.stateNotice}</p>
        )}
      </div>
      <div className="mt-auto flex justify-end gap-2">
        {showOpen && !openPrimary ? (
          <Button
            data-git-review-conflict-open=""
            disabled={busy}
            onClick={() => {
              openGitReviewPathInEditor({
                context,
                contextId,
                gitRootPath,
                path,
              });
            }}
            type="button"
            variant="outline"
          >
            {openLabel}
          </Button>
        ) : null}
        {gitReviewConflictFileActions(conflict.xy).map((spec) => (
          <Button
            disabled={busy}
            key={spec.action}
            onClick={() => {
              onResolve(spec.action);
            }}
            type="button"
            variant={spec.destructive ? "destructive" : "default"}
          >
            {fileLevelActionLabel(context, spec.intent)}
          </Button>
        ))}
        {showOpen && openPrimary ? (
          <Button
            data-git-review-conflict-open=""
            disabled={busy}
            onClick={() => {
              openGitReviewPathInEditor({
                context,
                contextId,
                gitRootPath,
                path,
              });
            }}
            type="button"
          >
            {openLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
