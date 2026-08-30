import {
  canonicalizeGitReviewTarget,
  type GitReviewCommitTarget,
  isGitReviewCommitRange,
} from "@shared/contracts/git/review.ts";

export type CommitRangeRole = "end" | "middle" | "single" | "start" | null;

export interface CommitClickResult {
  readonly originOid: string;
  readonly target: GitReviewCommitTarget;
}

export function orderCommitRangeByNewestFirst(
  firstOid: string,
  secondOid: string,
  newestFirstOids: readonly string[]
): { oldestOid: string; newestOid: string } | null {
  const firstIndex = newestFirstOids.indexOf(firstOid);
  const secondIndex = newestFirstOids.indexOf(secondOid);
  if (firstIndex < 0 || secondIndex < 0) {
    return null;
  }
  return firstIndex <= secondIndex
    ? { newestOid: firstOid, oldestOid: secondOid }
    : { newestOid: secondOid, oldestOid: firstOid };
}

export function commitTargetFromOids(
  newestOid: string,
  oldestOid: string
): GitReviewCommitTarget {
  return canonicalizeGitReviewTarget({
    fromOid: oldestOid,
    kind: "commit",
    oid: newestOid,
  }) as GitReviewCommitTarget;
}

export function visibleCommitCountInRange(
  oldestOid: string,
  newestOid: string,
  newestFirstOids: readonly string[]
): number | null {
  const oldestIndex = newestFirstOids.indexOf(oldestOid);
  const newestIndex = newestFirstOids.indexOf(newestOid);
  if (oldestIndex < 0 || newestIndex < 0) {
    return null;
  }
  return Math.abs(oldestIndex - newestIndex) + 1;
}

/** Prefer the unfiltered order list so a search that hides the origin still ranges. */
export function oidsForClickOrder(
  originOid: string | null,
  clickedOid: string,
  orderOids: readonly string[],
  listedOids: readonly string[]
): readonly string[] {
  if (
    originOid !== null &&
    orderOids.includes(originOid) &&
    orderOids.includes(clickedOid)
  ) {
    return orderOids;
  }
  return listedOids;
}

export function committedRangeFromSelection(
  selected: GitReviewCommitTarget | null
): { oldestOid: string; newestOid: string } | null {
  if (selected === null || !isGitReviewCommitRange(selected)) {
    return null;
  }
  return { newestOid: selected.oid, oldestOid: selected.fromOid };
}

export function previewCommitRange(input: {
  readonly hoverOid: string | null;
  readonly newestFirstOids: readonly string[];
  readonly originOid: string | null;
}): { oldestOid: string; newestOid: string } | null {
  if (
    input.originOid === null ||
    input.hoverOid === null ||
    input.hoverOid === input.originOid
  ) {
    return null;
  }
  return orderCommitRangeByNewestFirst(
    input.originOid,
    input.hoverOid,
    input.newestFirstOids
  );
}

export function visibleListedRange(
  range: { oldestOid: string; newestOid: string } | null,
  newestFirstOids: readonly string[]
): { oldestOid: string; newestOid: string } | null {
  if (
    range === null ||
    !newestFirstOids.includes(range.oldestOid) ||
    !newestFirstOids.includes(range.newestOid)
  ) {
    return null;
  }
  return range;
}

export type CommitRangeMarker = "checkbox" | "dot";

export function commitRangeVisual(
  oid: string,
  originOid: string | null,
  committed: { oldestOid: string; newestOid: string } | null,
  preview: { oldestOid: string; newestOid: string } | null,
  newestFirstOids: readonly string[],
  interaction: {
    readonly highlighted: boolean;
    readonly hovered: boolean;
  } = { highlighted: false, hovered: false }
): {
  readonly checked: boolean;
  readonly committedRole: CommitRangeRole;
  readonly marker: CommitRangeMarker;
  readonly previewRole: CommitRangeRole;
} {
  const committedRole = commitRangeRole(oid, committed, newestFirstOids);
  const previewRole = commitRangeRole(oid, preview, newestFirstOids);
  const checked = isCommitCheckboxChecked(oid, originOid, committed);
  const isRailEndpoint =
    committedRole === "end" ||
    committedRole === "single" ||
    committedRole === "start" ||
    previewRole === "end" ||
    previewRole === "single" ||
    previewRole === "start";
  const isRailInterior = committedRole === "middle" || previewRole === "middle";
  const showCheckbox =
    checked ||
    interaction.hovered ||
    interaction.highlighted ||
    isRailEndpoint ||
    !isRailInterior;
  return {
    checked,
    committedRole,
    marker: showCheckbox ? "checkbox" : "dot",
    previewRole,
  };
}

export function isCommitCheckboxChecked(
  oid: string,
  originOid: string | null,
  range: { oldestOid: string; newestOid: string } | null
): boolean {
  if (oid === originOid) {
    return true;
  }
  if (range === null || range.oldestOid === range.newestOid) {
    return false;
  }
  return oid === range.oldestOid || oid === range.newestOid;
}

export function commitRangeRole(
  oid: string,
  range: { oldestOid: string; newestOid: string } | null,
  newestFirstOids: readonly string[]
): CommitRangeRole {
  if (range === null) {
    return null;
  }
  if (range.oldestOid === range.newestOid) {
    return oid === range.newestOid ? "single" : null;
  }
  const oldestIndex = newestFirstOids.indexOf(range.oldestOid);
  const newestIndex = newestFirstOids.indexOf(range.newestOid);
  const index = newestFirstOids.indexOf(oid);
  if (oldestIndex < 0 || newestIndex < 0 || index < 0) {
    if (oid === range.newestOid) {
      return "start";
    }
    if (oid === range.oldestOid) {
      return "end";
    }
    return null;
  }
  const top = Math.min(oldestIndex, newestIndex);
  const bottom = Math.max(oldestIndex, newestIndex);
  if (index < top || index > bottom) {
    return null;
  }
  if (index === top) {
    return "start";
  }
  if (index === bottom) {
    return "end";
  }
  return "middle";
}

export function resolveCommitClick(input: {
  readonly clickedOid: string;
  readonly newestFirstOids: readonly string[];
  readonly originOid: string | null;
}): CommitClickResult {
  if (input.originOid === null || input.originOid === input.clickedOid) {
    return {
      originOid: input.clickedOid,
      target: { kind: "commit", oid: input.clickedOid },
    };
  }
  const ordered = orderCommitRangeByNewestFirst(
    input.originOid,
    input.clickedOid,
    input.newestFirstOids
  );
  if (ordered === null) {
    return {
      originOid: input.clickedOid,
      target: { kind: "commit", oid: input.clickedOid },
    };
  }
  return {
    originOid: input.clickedOid,
    target: commitTargetFromOids(ordered.newestOid, ordered.oldestOid),
  };
}
