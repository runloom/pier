import type {
  PierDiffViewChangeControl,
  PierDiffViewItem,
  PierDiffViewStageControl,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewIndexEntry,
  GitReviewMutationRequest,
} from "@shared/contracts/git/review.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { gitReviewFailureMessage } from "./message.ts";

export function reviewMutationBasename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

export function reviewMutationFailureBody(
  context: RendererPluginContext,
  error: GitReviewFailure | unknown
): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "kind" in error &&
    error.kind === "error" &&
    "reason" in error
  ) {
    const failure = error as GitReviewFailure;
    return [gitReviewFailureMessage(context, failure), failure.message]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }
  return error instanceof Error ? error.message : String(error);
}

export function showReviewMutationFailure(
  context: RendererPluginContext,
  title: string,
  error: GitReviewFailure | unknown
): Promise<void> {
  console.error(title, error);
  return context.dialogs.alert({
    body: reviewMutationFailureBody(context, error),
    title,
  });
}

export function displayReviewItemsWithMutationPending(
  items: readonly PierDiffViewItem[],
  pendingFileActions: ReadonlyMap<
    string,
    NonNullable<PierDiffViewStageControl["pendingAction"]>
  >,
  pendingChangeActions: ReadonlyMap<
    string,
    NonNullable<PierDiffViewChangeControl["pendingAction"]>
  >
): readonly PierDiffViewItem[] {
  if (pendingFileActions.size === 0 && pendingChangeActions.size === 0) {
    return items;
  }
  return items.map((item) => {
    const pendingFileAction = pendingFileActions.get(item.id);
    const fileBusy = pendingFileAction !== undefined;
    const hasBusyChange = item.changeControls?.some((control) =>
      pendingChangeActions.has(control.changeKey)
    );
    if (!(fileBusy || hasBusyChange)) {
      return item;
    }
    return {
      ...item,
      ...(item.changeControls === undefined
        ? {}
        : {
            changeControls: item.changeControls.map((control) => {
              const pendingAction = pendingChangeActions.get(control.changeKey);
              return {
                ...control,
                busy: control.busy === true || pendingAction !== undefined,
                ...(pendingAction === undefined ? {} : { pendingAction }),
              };
            }),
          }),
      ...(!fileBusy || item.stageControl == null
        ? {}
        : {
            stageControl: {
              ...item.stageControl,
              busy: true,
              pendingAction: pendingFileAction,
            },
          }),
    };
  });
}

export function resolveReviewMutationSection(
  entries: readonly GitReviewIndexEntry[] | undefined,
  items: readonly PierDiffViewItem[],
  itemId: string
): {
  readonly entry: GitReviewIndexEntry;
  readonly slot: GitReviewIndexEntry["renderSlots"][number] | null;
} | null {
  if (!entries) {
    return null;
  }
  for (const entry of entries) {
    const slot = entry.renderSlots.find(
      (candidate) => candidate.sectionKey === itemId
    );
    if (slot !== undefined) {
      return { entry, slot };
    }
  }
  const item = items.find((candidate) => candidate.id === itemId);
  const path = item?.fileDisplay?.path;
  const entry =
    path === undefined
      ? undefined
      : entries.find((candidate) => candidate.path === path);
  return entry === undefined ? null : { entry, slot: null };
}

export function reviewMutationSource(
  contextId: string,
  gitRootPath: string | undefined,
  entry: GitReviewIndexEntry
): GitReviewMutationRequest["source"] | null {
  if (!gitRootPath) {
    return null;
  }
  return {
    contextId,
    gitRootPath,
    oldPaths: [...entry.oldPaths],
    path: entry.path,
    target: { kind: "uncommitted" },
  };
}

export function withReviewMutationPending<TAction>(
  setPending: Dispatch<SetStateAction<Map<string, TAction>>>,
  pendingRef: RefObject<Map<string, TAction>>,
  key: string,
  action: TAction,
  run: () => Promise<unknown>
): Promise<unknown> {
  // 正文高度变化交给 Pierre 行级 scroll anchoring；勿钉 raw scrollTop。
  const pending = new Map(pendingRef.current);
  pending.set(key, action);
  pendingRef.current = pending;
  setPending(pending);
  return run().finally(() => {
    const current = pendingRef.current;
    if (!current.has(key)) {
      return;
    }
    const next = new Map(current);
    next.delete(key);
    pendingRef.current = next;
    setPending(next);
  });
}
