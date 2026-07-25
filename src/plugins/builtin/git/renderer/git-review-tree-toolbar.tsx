import { Button } from "@pier/ui/button.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { useCallback, useState } from "react";
import { notifyError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";
import {
  collectStageAllPaths,
  collectUnstageAllPaths,
  stageAllFromEntries,
  unstageAllFromEntries,
} from "./git-stage-all.ts";

/**
 * Changes 侧栏树顶工具条：全部暂存 / 全部取消暂存。
 * 仅 uncommitted scope 渲染；动作直接吃当前 index entries，不进命令面板。
 */
export function GitReviewTreeToolbar({
  context,
  entries,
  gitRootPath,
  onSkippedConflicts,
}: {
  readonly context: RendererPluginContext;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly gitRootPath: string;
  readonly onSkippedConflicts?: (
    staged: number,
    skippedConflicts: number
  ) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState<"stage" | "unstage" | null>(null);
  const canStage = collectStageAllPaths(entries).paths.length > 0;
  const canUnstage = collectUnstageAllPaths(entries).length > 0;

  const runStageAll = useCallback(async () => {
    if (busy !== null || !canStage) {
      return;
    }
    setBusy("stage");
    try {
      const result = await stageAllFromEntries(
        context.git,
        gitRootPath,
        entries
      );
      if (result && result.skippedConflicts > 0) {
        if (onSkippedConflicts) {
          onSkippedConflicts(result.staged, result.skippedConflicts);
        } else {
          context.notifications.info(
            pluginText(
              context,
              "stageAllSkippedConflicts",
              "Staged {{staged}} file(s), skipped {{n}} conflicted",
              { n: result.skippedConflicts, staged: result.staged }
            )
          );
        }
      }
    } catch (error) {
      notifyError(
        context,
        pluginText(context, "reviewTreeStageFailed", "Unable to Stage"),
        error
      );
    } finally {
      setBusy(null);
    }
  }, [busy, canStage, context, entries, gitRootPath, onSkippedConflicts]);

  const runUnstageAll = useCallback(async () => {
    if (busy !== null || !canUnstage) {
      return;
    }
    setBusy("unstage");
    try {
      await unstageAllFromEntries(context.git, gitRootPath, entries);
    } catch (error) {
      notifyError(
        context,
        pluginText(context, "reviewTreeUnstageFailed", "Unable to Unstage"),
        error
      );
    } finally {
      setBusy(null);
    }
  }, [busy, canUnstage, context, entries, gitRootPath]);

  const stageLabel =
    busy === "stage"
      ? pluginText(context, "stageAllBusy", "Staging…")
      : pluginText(context, "stageAll", "Stage All");
  const unstageLabel =
    busy === "unstage"
      ? pluginText(context, "unstageAllBusy", "Unstaging…")
      : pluginText(context, "unstageAll", "Unstage All");

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-border border-b px-2 py-1.5"
      data-testid="git-review-tree-toolbar"
    >
      <Button
        className="min-w-0 flex-1"
        disabled={busy !== null || !canStage}
        onClick={() => {
          runStageAll().catch(() => undefined);
        }}
        size="default"
        type="button"
        variant="outline"
      >
        <span className="truncate">{stageLabel}</span>
      </Button>
      <Button
        className="min-w-0 flex-1"
        disabled={busy !== null || !canUnstage}
        onClick={() => {
          runUnstageAll().catch(() => undefined);
        }}
        size="default"
        type="button"
        variant="outline"
      >
        <span className="truncate">{unstageLabel}</span>
      </Button>
    </div>
  );
}
