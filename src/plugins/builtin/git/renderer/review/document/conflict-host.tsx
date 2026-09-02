import type {
  PierDiffViewItem,
  PierUnresolvedConflictHost,
  PierUnresolvedConflictLabels,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewMutationOk } from "@shared/contracts/git/review.ts";
import { useCallback, useMemo, useState } from "react";
import { pluginText } from "../../plugin-text.ts";
import { usePluginLanguage } from "../../use-plugin-language.ts";
import type { GitReviewMutationTransition } from "../reading-surface.ts";
import { FileLevelConflictCard } from "./conflict-file-level.tsx";
import { isConflictSurfaceItem } from "./conflict-focus.ts";

export function useReviewUnresolvedConflictHost(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly gitRootPath?: string;
  readonly items: readonly PierDiffViewItem[];
  readonly mutationLocked: boolean;
  readonly onMutationCommitted?: (
    result: GitReviewMutationOk | null,
    transition?: GitReviewMutationTransition
  ) => Promise<void>;
}): PierUnresolvedConflictHost | undefined {
  const {
    context,
    contextId,
    gitRootPath,
    items,
    mutationLocked,
    onMutationCommitted,
  } = options;
  const language = usePluginLanguage();
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const hasConflict = items.some(isConflictSurfaceItem);

  // biome-ignore lint/correctness/useExhaustiveDependencies: language drives i18n re-read
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
      stageFile: pluginText(context, "reviewHeaderStage", "Stage"),
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
    [context, language]
  );

  const sourceFor = useCallback(
    (path: string) => ({
      contextId,
      gitRootPath: gitRootPath ?? "",
      oldPaths: [] as string[],
      path,
      target: { kind: "uncommitted" as const },
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

  const itemById = useCallback(
    (itemId: string) => items.find((item) => item.id === itemId),
    [items]
  );

  const onWriteResolved = useCallback(
    async (
      itemId: string,
      payload: { readonly contents: string; readonly contentsDigest: string }
    ) => {
      const target = itemById(itemId);
      const path = target?.fileDisplay?.path;
      const conflict = target?.conflict;
      if (!(gitRootPath && path) || conflict === undefined) {
        return;
      }
      setBusyItemId(itemId);
      try {
        const result = await context.git.resolveReviewConflict({
          action: "write",
          expectedContentsDigest: payload.contentsDigest,
          operationId: crypto.randomUUID(),
          resolvedContents: payload.contents,
          source: sourceFor(path),
        });
        if (result.kind === "error") {
          throw new Error(result.message ?? result.reason);
        }
        await onMutationCommitted?.(result);
      } finally {
        setBusyItemId(null);
      }
    },
    [context, gitRootPath, itemById, onMutationCommitted, sourceFor]
  );

  const onResolveFile = useCallback(
    async (itemId: string, action: "ours" | "stage" | "theirs") => {
      const target = itemById(itemId);
      const path = target?.fileDisplay?.path;
      if (!(gitRootPath && path)) {
        return;
      }
      setBusyItemId(itemId);
      try {
        const result = await context.git.resolveReviewConflict({
          action,
          operationId: crypto.randomUUID(),
          source: sourceFor(path),
        });
        if (result.kind === "error") {
          throw new Error(result.message ?? result.reason);
        }
        await onMutationCommitted?.(result);
      } catch (error) {
        await alertResolveFailed(error);
      } finally {
        setBusyItemId(null);
      }
    },
    [
      alertResolveFailed,
      context,
      gitRootPath,
      itemById,
      onMutationCommitted,
      sourceFor,
    ]
  );

  const renderFileLevel = useCallback(
    (input: {
      readonly busy: boolean;
      readonly conflict: NonNullable<PierDiffViewItem["conflict"]>;
      readonly itemId: string;
    }) => (
      <FileLevelConflictCard
        busy={input.busy}
        conflict={input.conflict}
        context={context}
        itemId={input.itemId}
        onResolve={(action) => {
          onResolveFile(input.itemId, action).catch(() => undefined);
        }}
      />
    ),
    [context, onResolveFile]
  );

  return useMemo(() => {
    if (!hasConflict) {
      return;
    }
    return {
      busyItemId,
      labels,
      mutationLocked,
      onError: (error: Error) => {
        alertResolveFailed(error).catch(() => undefined);
      },
      onResolveFile: (itemId, action) => {
        onResolveFile(itemId, action).catch(() => undefined);
      },
      onWriteResolved,
      renderFileLevel,
    } satisfies PierUnresolvedConflictHost;
  }, [
    alertResolveFailed,
    busyItemId,
    hasConflict,
    labels,
    mutationLocked,
    onResolveFile,
    onWriteResolved,
    renderFileLevel,
  ]);
}
