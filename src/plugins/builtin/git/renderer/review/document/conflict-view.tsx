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
import type {
  GitReviewFileSource,
  GitReviewMutationOk,
} from "@shared/contracts/git/review.ts";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { pluginText } from "../../plugin-text.ts";
import { openGitReviewPathInEditor } from "../diff-actions.ts";

/** UnresolvedFile host for markers-text conflict items. */
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
    async (item: PierDiffViewItem, resolvedContents: string) => {
      const path = item.fileDisplay?.path;
      const conflict = item.conflict;
      if (!path || conflict === undefined) {
        return;
      }
      setBusyId(item.id);
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
        className="flex h-full min-h-0 min-w-0 flex-col overflow-auto"
        data-git-review-conflict-view=""
      >
        {items.map((item) => {
          const path = item.fileDisplay?.path ?? item.id;
          const conflict = item.conflict;
          if (
            conflict === undefined ||
            conflict.presentation !== "markers-text" ||
            conflict.contents === null
          ) {
            return null;
          }
          return (
            <div
              className="min-h-[12rem] shrink-0 border-border border-b last:border-b-0"
              data-git-review-conflict-item={item.id}
              key={item.id}
              style={{ minHeight: "40vh" }}
            >
              <PierUnresolvedConflictView
                appearance={appearance}
                busy={mutationBlocked || busyId === item.id}
                conflict={conflict}
                labels={labels}
                onError={(error) => {
                  alertResolveFailed(error).catch(() => undefined);
                }}
                onOpenFile={() => {
                  openGitReviewPathInEditor({
                    context,
                    contextId,
                    gitRootPath,
                    path,
                  });
                }}
                onWriteResolved={({ contents }) =>
                  writeResolved(item, contents)
                }
                path={path}
                {...(presentation === undefined ? {} : { presentation })}
              />
            </div>
          );
        })}
      </div>
    </PierDiffWorkerProvider>
  );
}
