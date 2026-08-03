import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitChangeSummary } from "@shared/contracts/git.ts";
import type React from "react";
import { pluginText } from "./plugin-text.ts";

const LINE_DELETION_SIGN = "\u2212";

/** 有可展示的行增量时才画 +/-；全 0（例如全是 excluded）退回文件数。 */
export function gitChangeSummaryHasVisibleLineDelta(
  summary: GitChangeSummary
): boolean {
  return (
    summary.kind === "lineDelta" &&
    (summary.insertions > 0 || summary.deletions > 0)
  );
}

function changedFilesVisibleLabel(
  context: RendererPluginContext,
  count: number
): string {
  return pluginText(
    context,
    count === 1 ? "changeSummaryFileVisible" : "changeSummaryFilesVisible",
    count === 1 ? "{{count}} file" : "{{count}} files",
    { count }
  );
}

export function gitChangeSummaryAccessibleLabel(
  context: RendererPluginContext,
  summary: GitChangeSummary
): string {
  const files = pluginText(
    context,
    summary.changedFiles === 1
      ? "changeSummaryFileAccessible"
      : "changeSummaryFilesAccessible",
    summary.changedFiles === 1
      ? "{{count}} changed file"
      : "{{count}} changed files",
    { count: summary.changedFiles }
  );
  if (summary.kind === "filesOnly") {
    return [
      files,
      pluginText(
        context,
        "changeSummaryLinesUnavailable",
        "Line totals are unavailable for {{count}} files.",
        { count: summary.omittedFiles }
      ),
    ].join(", ");
  }
  if (!gitChangeSummaryHasVisibleLineDelta(summary)) {
    const parts = [files];
    if (summary.excludedFiles > 0) {
      parts.push(
        pluginText(
          context,
          "changeSummaryExcludedAccessible",
          "{{count}} files excluded from line totals",
          { count: summary.excludedFiles }
        )
      );
    }
    return parts.join(", ");
  }
  const parts = [
    files,
    pluginText(
      context,
      "changeSummaryInsertionsAccessible",
      "{{count}} insertions",
      { count: summary.insertions }
    ),
    pluginText(
      context,
      "changeSummaryDeletionsAccessible",
      "{{count}} deletions",
      { count: summary.deletions }
    ),
  ];
  if (summary.excludedFiles > 0) {
    parts.push(
      pluginText(
        context,
        "changeSummaryExcludedAccessible",
        "{{count}} files excluded from line totals",
        { count: summary.excludedFiles }
      )
    );
  }
  return parts.join(", ");
}

export function gitChangeSummaryTitle(
  context: RendererPluginContext,
  summary: GitChangeSummary
): string | undefined {
  if (summary.kind === "filesOnly") {
    return pluginText(
      context,
      "changeSummaryFilesOnlyTitle",
      "Line totals are incomplete. Showing the changed file count."
    );
  }
  if (summary.excludedFiles > 0) {
    return pluginText(
      context,
      "changeSummaryExcludedTitle",
      "{{count}} files are not included in the line totals.",
      { count: summary.excludedFiles }
    );
  }
  return;
}

export function GitChangeSummaryInline({
  className,
  context,
  filesWithUnit = true,
  summary,
  testId,
}: {
  readonly className?: string;
  readonly context: RendererPluginContext;
  /** 文件数回退时是否带 “file(s)” 单位；默认 true，避免裸数字误读。 */
  readonly filesWithUnit?: boolean;
  readonly summary: GitChangeSummary;
  readonly testId?: string;
}): React.JSX.Element {
  const accessibleLabel = gitChangeSummaryAccessibleLabel(context, summary);
  const title = gitChangeSummaryTitle(context, summary);
  const visibleLineDelta =
    summary.kind === "lineDelta" && gitChangeSummaryHasVisibleLineDelta(summary)
      ? summary
      : null;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 tabular-nums",
        className
      )}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      {...(title === undefined ? {} : { title })}
    >
      <span
        aria-hidden="true"
        className="inline-flex min-w-0 items-center gap-1"
      >
        {visibleLineDelta ? (
          <>
            <span className="text-success" data-git-delta="insertions">
              +{visibleLineDelta.insertions}
            </span>
            <span className="text-status-danger-fg" data-git-delta="deletions">
              {LINE_DELETION_SIGN}
              {visibleLineDelta.deletions}
            </span>
          </>
        ) : (
          <span className="truncate" data-git-delta="files">
            {filesWithUnit
              ? changedFilesVisibleLabel(context, summary.changedFiles)
              : summary.changedFiles}
          </span>
        )}
      </span>
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  );
}
