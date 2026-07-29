import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitChangeSummary } from "@shared/contracts/git.ts";
import type React from "react";
import { pluginText } from "./git-plugin-text.ts";

const LINE_DELETION_SIGN = "\u2212";

export function gitChangeSummaryHasLineDelta(
  summary: GitChangeSummary
): summary is Extract<GitChangeSummary, { kind: "lineDelta" }> {
  return summary.kind === "lineDelta";
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
  filesWithUnit = false,
  summary,
  testId,
}: {
  readonly className?: string;
  readonly context: RendererPluginContext;
  readonly filesWithUnit?: boolean;
  readonly summary: GitChangeSummary;
  readonly testId?: string;
}): React.JSX.Element {
  const accessibleLabel = gitChangeSummaryAccessibleLabel(context, summary);
  const title = gitChangeSummaryTitle(context, summary);
  const showDelta = gitChangeSummaryHasLineDelta(summary);

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
        {showDelta ? (
          <>
            <span className="text-success" data-git-delta="insertions">
              +{summary.insertions}
            </span>
            <span className="text-status-danger-fg" data-git-delta="deletions">
              {LINE_DELETION_SIGN}
              {summary.deletions}
            </span>
          </>
        ) : (
          <span className="truncate">
            {filesWithUnit
              ? pluginText(
                  context,
                  summary.changedFiles === 1
                    ? "changeSummaryFileVisible"
                    : "changeSummaryFilesVisible",
                  summary.changedFiles === 1
                    ? "{{count}} file"
                    : "{{count}} files",
                  { count: summary.changedFiles }
                )
              : summary.changedFiles}
          </span>
        )}
      </span>
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  );
}
