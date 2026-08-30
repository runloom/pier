import { PopoverTrigger } from "@pier/ui/popover.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewCommitTarget } from "@shared/contracts/git/review.ts";
import type { GitCommit } from "@shared/contracts/git.ts";
import { GitCommitHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shortCommitHash } from "../../commit-quick-pick-row.tsx";
import { pluginText } from "../../plugin-text.ts";
import { ComboboxTriggerButton } from "./combobox-trigger.tsx";
import { useOptionalGitReviewCommitPickerSession } from "./commit-picker-context.tsx";
import { GitReviewCommitPickerSession } from "./commit-picker-session.tsx";
import { visibleCommitCountInRange } from "./commit-range.ts";

function commitMatchesOid(commit: GitCommit, oid: string): boolean {
  return (
    commit.hash === oid ||
    commit.hash.startsWith(oid) ||
    oid.startsWith(commit.hash)
  );
}

function commitTriggerRangeCount(
  fromOid: string | null,
  oid: string | null,
  visibleOids: readonly string[]
): number | null {
  if (fromOid === null || oid === null || fromOid === oid) {
    return null;
  }
  return visibleCommitCountInRange(fromOid, oid, visibleOids);
}

function commitTriggerLabel(
  selectedOid: string,
  selected: { oid: string; message: string } | null
): string {
  if (selected?.oid === selectedOid) {
    const subject = selected.message.trim();
    if (subject.length > 0) {
      return subject;
    }
  }
  return shortCommitHash(selectedOid);
}

function commitTriggerAriaLabel(input: {
  readonly context: RendererPluginContext;
  readonly fromOid: string | null;
  readonly oid: string | null;
  readonly rangeCount: number | null;
  readonly subject: string | null;
}): string | undefined {
  if (input.oid === null) {
    return;
  }
  const hash = shortCommitHash(input.oid);
  const subject = input.subject;
  if (input.fromOid !== null && input.fromOid !== input.oid) {
    const from = shortCommitHash(input.fromOid);
    if (input.rangeCount !== null && input.rangeCount >= 2) {
      if (subject !== null && subject.length > 0) {
        return pluginText(
          input.context,
          "reviewScopeCommitRangeTriggerAria",
          "{{count}} commits: {{subject}}",
          { count: input.rangeCount, subject }
        );
      }
      return pluginText(
        input.context,
        "reviewScopeCommitRangeTriggerAriaIdentity",
        "{{count}} commits, {{from}} to {{to}}",
        { count: input.rangeCount, from, to: hash }
      );
    }
    if (subject !== null && subject.length > 0) {
      return pluginText(
        input.context,
        "reviewScopeCommitRangeTriggerAriaEndsSubject",
        "Commits {{from}} to {{to}}: {{subject}}",
        { from, subject, to: hash }
      );
    }
    return pluginText(
      input.context,
      "reviewScopeCommitRangeTriggerAriaEnds",
      "Commits {{from}} to {{to}}",
      { from, to: hash }
    );
  }
  if (subject !== null && subject.length > 0) {
    return pluginText(
      input.context,
      "reviewScopeCommitTriggerAria",
      "Commit {{hash}}: {{subject}}",
      { hash, subject }
    );
  }
  return pluginText(
    input.context,
    "reviewScopeCommitTriggerAriaHash",
    "Commit {{hash}}",
    { hash }
  );
}

function commitTriggerTrailing(
  context: RendererPluginContext,
  fromOid: string | null,
  oid: string | null,
  rangeCount: number | null
): string | null {
  if (fromOid === null || oid === null || fromOid === oid) {
    return null;
  }
  if (rangeCount !== null && rangeCount >= 2) {
    return pluginText(
      context,
      "reviewScopeCommitRangeCount",
      "{{count}} commits",
      { count: rangeCount }
    );
  }
  return `${shortCommitHash(fromOid)}–${shortCommitHash(oid)}`;
}

function GitReviewCommitPickerTrigger({
  context,
  gitRootPath,
  selectedFromOid,
  selectedOid,
}: {
  readonly context: RendererPluginContext;
  readonly gitRootPath: string;
  readonly selectedFromOid: string | null;
  readonly selectedOid: string | null;
}): React.JSX.Element {
  const [selected, setSelected] = useState<{
    oid: string;
    message: string;
  } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const session = useOptionalGitReviewCommitPickerSession();
  const rangeCount =
    commitTriggerRangeCount(
      selectedFromOid,
      selectedOid,
      session?.orderOids ?? []
    ) ??
    commitTriggerRangeCount(
      selectedFromOid,
      selectedOid,
      session?.visibleOids ?? []
    ) ??
    session?.rangeCount ??
    null;
  const remembered =
    session?.rememberedCommit?.oid === selectedOid
      ? session.rememberedCommit
      : null;

  useEffect(() => {
    if (selectedOid === null) {
      setSelected(null);
      return;
    }
    if (remembered !== null && remembered.message.trim().length > 0) {
      setSelected(remembered);
      return;
    }
    const cached = selectedRef.current;
    if (cached?.oid === selectedOid && cached.message.trim().length > 0) {
      return;
    }
    let cancelled = false;
    context.git
      .searchCommits(gitRootPath, { limit: 1, query: selectedOid })
      .then((result) => {
        if (cancelled || result.status !== "ok") {
          return;
        }
        const match =
          result.items.find((commit) =>
            commitMatchesOid(commit, selectedOid)
          ) ?? null;
        if (!match) {
          return;
        }
        setSelected({ message: match.message, oid: selectedOid });
      })
      .catch(() => {
        // 解析失败保持短 hash 兜底,不打扰用户。
      });
    return () => {
      cancelled = true;
    };
  }, [context, gitRootPath, remembered, selectedOid]);

  const resolved = remembered ?? selected;
  const subject =
    selectedOid !== null &&
    resolved?.oid === selectedOid &&
    resolved.message.trim().length > 0
      ? resolved.message.trim()
      : null;
  const trailing = commitTriggerTrailing(
    context,
    selectedFromOid,
    selectedOid,
    rangeCount
  );

  return (
    <PopoverTrigger asChild>
      <ComboboxTriggerButton
        aria-label={commitTriggerAriaLabel({
          context,
          fromOid: selectedFromOid,
          oid: selectedOid,
          rangeCount,
          subject,
        })}
        icon={<GitCommitHorizontal data-icon="inline-start" />}
        label={
          selectedOid === null
            ? null
            : commitTriggerLabel(selectedOid, resolved)
        }
        placeholder={pluginText(
          context,
          "reviewScopeSelectCommit",
          "Select a commit"
        )}
        testId="git-review-commit-combobox"
        trailing={trailing}
      />
    </PopoverTrigger>
  );
}

export function GitReviewCommitCombobox({
  context,
  gitRootPath,
  onSelectTarget,
  selectedFromOid = null,
  selectedOid,
}: {
  readonly context: RendererPluginContext;
  readonly gitRootPath: string;
  readonly onSelectTarget: (target: GitReviewCommitTarget) => void;
  readonly selectedFromOid?: string | null;
  readonly selectedOid: string | null;
}): React.JSX.Element {
  const session = useOptionalGitReviewCommitPickerSession();
  const trigger = (
    <GitReviewCommitPickerTrigger
      context={context}
      gitRootPath={gitRootPath}
      selectedFromOid={selectedFromOid}
      selectedOid={selectedOid}
    />
  );
  if (session) {
    return trigger;
  }
  return (
    <GitReviewCommitPickerSession
      context={context}
      enabled
      gitRootPath={gitRootPath}
      onSelectTarget={onSelectTarget}
      selectedFromOid={selectedFromOid}
      selectedOid={selectedOid}
    >
      {trigger}
    </GitReviewCommitPickerSession>
  );
}
