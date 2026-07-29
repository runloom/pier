import type { PierDiffViewItem } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { estimateReviewSlotItem } from "./git-review-document-estimates.ts";
import type { ReviewDocumentProjection } from "./git-review-document-projection-types.ts";
import type {
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import { projectReviewDocumentResource } from "./git-review-document-resource-projection.ts";
import type { GitReviewReadingSurface } from "./git-review-reading-surface.ts";
import {
  GIT_REVIEW_PRESENTATION_GROUP_ORDER,
  reviewGroupsForSurface,
} from "./git-review-surface-group.ts";

type ReviewProjectionGroup = GitReviewGroup;
type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];

interface ProjectedRow {
  readonly group: ReviewProjectionGroup;
  readonly item: PierDiffViewItem;
  readonly path: string;
}

const REVIEW_PROJECTION_GROUP_INDEX = new Map<ReviewProjectionGroup, number>(
  GIT_REVIEW_PRESENTATION_GROUP_ORDER.map((group, index) => [group, index])
);

/** One CodeView item per staged/unstaged index slot, grouped like Zed. */
export function projectReviewLedger(options: {
  readonly allowedBodyEntryKeys?: ReadonlySet<string>;
  readonly authoritativeEntryKeys?: ReadonlySet<string>;
  readonly context: RendererPluginContext;
  readonly diffBase?: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly locale: string;
  readonly measuredEstimateLinesByPath?: ReadonlyMap<string, number>;
  readonly resourceByEntryKey: ReadonlyMap<string, GitReviewDocumentResource>;
  readonly sourceIndexGeneration?: number;
}): ReviewDocumentProjection {
  const entryKeyBySectionId = new Map<string, string>();
  const revisionBySectionId = new Map<string, string>();
  const decorated: ProjectedRow[] = [];
  for (const entry of options.entries) {
    const resource = options.resourceByEntryKey.get(entry.entryKey);
    const allowLoaded =
      options.allowedBodyEntryKeys === undefined ||
      options.allowedBodyEntryKeys.has(entry.entryKey);
    const projected =
      resource !== undefined && allowLoaded
        ? projectReviewDocumentResource(
            resource,
            options.context,
            options.locale
          ).items
        : [];
    const projectedById = new Map(projected.map((item) => [item.id, item]));
    const mutationReady =
      resource?.kind === "loaded" &&
      allowLoaded &&
      (options.authoritativeEntryKeys === undefined ||
        options.authoritativeEntryKeys.has(entry.entryKey));
    const slots = slotsForDiffBase(entry, options.diffBase);
    for (const slot of slots) {
      const item = gateReviewMutationControls(
        projectedById.get(slot.sectionKey) ??
          estimateReviewLedgerSlot(
            entry,
            slot,
            options.measuredEstimateLinesByPath
          ),
        mutationReady
      );
      decorated.push({ group: slot.group, item, path: entry.path });
      entryKeyBySectionId.set(item.id, entry.entryKey);
      if (resource?.kind === "loaded" && allowLoaded && mutationReady) {
        revisionBySectionId.set(slot.sectionKey, resource.document.revision);
      }
    }
  }
  decorated.sort(compareProjectedRows);
  return {
    entryKeyBySectionId,
    items: decorated.map((row) => row.item),
    revisionBySectionId,
    sourceIndexGeneration: options.sourceIndexGeneration ?? 0,
  };
}

export function projectReviewDocuments(
  snapshot: GitReviewDocumentLoaderSnapshot,
  context: RendererPluginContext,
  locale: string
): ReviewDocumentProjection {
  const entries = snapshot.resources
    .filter(
      (resource) => resource.kind === "loaded" || resource.kind === "error"
    )
    .map((resource) => resource.entry);
  return projectReviewLedger({
    context,
    entries,
    locale,
    resourceByEntryKey: new Map(
      snapshot.resources.map((resource) => [resource.entry.entryKey, resource])
    ),
  });
}

function gateReviewMutationControls(
  item: PierDiffViewItem,
  mutationReady: boolean
): PierDiffViewItem {
  if (mutationReady) {
    return item;
  }
  return {
    ...item,
    ...(item.stageControl == null
      ? {}
      : { stageControl: { ...item.stageControl, busy: true } }),
  };
}

function compareProjectedRows(left: ProjectedRow, right: ProjectedRow): number {
  return (
    reviewProjectionGroupIndex(left.group) -
      reviewProjectionGroupIndex(right.group) ||
    left.path.localeCompare(right.path) ||
    left.item.id.localeCompare(right.item.id)
  );
}

function reviewProjectionGroupIndex(group: ReviewProjectionGroup): number {
  const index = REVIEW_PROJECTION_GROUP_INDEX.get(group);
  if (index === undefined) {
    throw new Error(`Missing Git review projection order for ${group}`);
  }
  return index;
}

function slotsForDiffBase(
  entry: GitReviewIndexEntry,
  diffBase: GitReviewReadingSurface | undefined
): readonly ReviewSlot[] {
  if (diffBase === undefined) {
    return entry.renderSlots;
  }
  const groups = reviewGroupsForSurface(diffBase);
  return entry.renderSlots.filter((slot) => groups.includes(slot.group));
}

function estimateReviewLedgerSlot(
  entry: GitReviewIndexEntry,
  slot: ReviewSlot,
  measuredEstimateLinesByPath: ReadonlyMap<string, number> | undefined
): PierDiffViewItem {
  if (measuredEstimateLinesByPath === undefined) {
    return estimateReviewSlotItem({ entry, slot });
  }
  return estimateReviewSlotItem({
    entry,
    measuredEstimateLinesByPath,
    slot,
  });
}
