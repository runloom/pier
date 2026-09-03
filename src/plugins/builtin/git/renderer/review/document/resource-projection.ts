import type {
  PierDiffReviewDriftThread,
  PierDiffViewItem,
  PierImageDiffSide,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewImageSide,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { isReviewSlotIncludedInBody } from "./body-class.ts";
import {
  classifyInlineDrift,
  type ReviewCommentIndex,
} from "./comment-projection.ts";
import { lineStatsFromReviewSlot, reviewStageControl } from "./estimates.ts";
import type { ReviewDocumentResourceProjection } from "./projection-types.ts";
import type { GitReviewDocumentResource } from "./resource.ts";
import { conflictSectionText, stateSectionText } from "./state-text.ts";

/**
 * WeakMap keyed by the immutable document object, same as documentMetricsCache.
 */
const projectionsByDocument = new WeakMap<
  GitReviewFileDocumentOk,
  Map<string, ReviewDocumentResourceProjection>
>();

/** Comment-seq churn is capped per document. */
export const GIT_REVIEW_PROJECTIONS_PER_DOCUMENT = 8;

function projectionsFor(
  document: GitReviewFileDocumentOk
): Map<string, ReviewDocumentResourceProjection> {
  let projections = projectionsByDocument.get(document);
  if (projections === undefined) {
    projections = new Map();
    projectionsByDocument.set(document, projections);
  }
  return projections;
}

function rememberProjection(
  projections: Map<string, ReviewDocumentResourceProjection>,
  key: string,
  projection: ReviewDocumentResourceProjection
): void {
  projections.delete(key);
  projections.set(key, projection);
  while (projections.size > GIT_REVIEW_PROJECTIONS_PER_DOCUMENT) {
    const oldest = projections.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    projections.delete(oldest);
  }
}

type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];

export function isCodeViewMemberResource(
  resource: GitReviewDocumentResource
): resource is Extract<
  GitReviewDocumentResource,
  { kind: "loaded" | "error" }
> {
  return resource.kind === "loaded" || resource.kind === "error";
}

export function projectReviewDocumentResource(
  resource: GitReviewDocumentResource,
  context: RendererPluginContext,
  locale: string,
  comments?: ReviewCommentIndex,
  commentsSeq?: number
): ReviewDocumentResourceProjection {
  if (!isCodeViewMemberResource(resource)) {
    return { items: [] };
  }
  if (resource.kind === "error") {
    return projectFailedReviewDocumentResource(resource, context);
  }
  const projections = projectionsFor(resource.document);
  // 文档对象已是内容身份；key 只需区分阅读面 entry 映射、locale 与评论 seq
  // （评论变化须失效缓存，否则行内评论不刷新）。
  const projectionKey = JSON.stringify([
    locale,
    resource.entry,
    commentsSeq ?? 0,
  ]);
  const cached = projections.get(projectionKey);
  if (cached !== undefined) {
    return cached;
  }
  const projection = projectLoadedReviewDocumentResource(
    resource,
    context,
    locale,
    comments
  );
  rememberProjection(projections, projectionKey, projection);
  return projection;
}

function projectFailedReviewDocumentResource(
  resource: Extract<GitReviewDocumentResource, { kind: "error" }>,
  context: RendererPluginContext
): ReviewDocumentResourceProjection {
  // timeout 走专用文案；其余通用失败（均已 i18n）
  const notice =
    resource.failure.reason === "timeout"
      ? context.i18n.t(
          "ui.reviewFailureTimeout",
          undefined,
          "Reading the change timed out."
        )
      : context.i18n.t(
          "ui.reviewDocumentLoadFailed",
          undefined,
          "Unable to load this change"
        );
  // 仅正文槽进列表；notice 由账本直接出说明卡，不依赖 loaded document
  const slotItems = resource.entry.renderSlots
    .filter((slot) => isReviewSlotIncludedInBody(slot))
    .map((slot) => {
      const stageControl = reviewStageControl(slot.group, slot.status);
      const lineStats = lineStatsFromReviewSlot(slot);
      return {
        cacheKey: `git-review-error:${slot.sectionKey}:${resource.failure.reason}`,
        fileDisplay: fileDisplayForSlot(slot),
        id: slot.sectionKey,
        kind: "error" as const,
        ...(lineStats === undefined ? {} : { lineStats }),
        patch: null,
        ...(stageControl === null ? {} : { stageControl }),
        stateNotice: notice,
      };
    });
  return { items: slotItems };
}

function projectLoadedReviewDocumentResource(
  resource: Extract<GitReviewDocumentResource, { kind: "loaded" }>,
  context: RendererPluginContext,
  locale: string,
  comments?: ReviewCommentIndex
): ReviewDocumentResourceProjection {
  const sections = new Map(
    resource.document.sections.map((section) => [section.sectionKey, section])
  );
  const slotItems = resource.entry.renderSlots
    .filter((slot) => isReviewSlotIncludedInBody(slot))
    .flatMap((slot): PierDiffViewItem[] => {
      // 精确匹配 sectionKey；stage 迁移后旧 document 的 unstaged key 对不上
      // staged slot 时，回退到「同 group 唯一 patch 段」以免空投影 + 坏 estimate。
      const section =
        sections.get(slot.sectionKey) ??
        fallbackSectionForSlot(resource.document, slot, sections);
      if (section === undefined) {
        return [];
      }
      const stageControl = reviewStageControl(slot.group, slot.status);
      const lineStats = lineStatsFromReviewSlot(slot);
      // item id 始终用当前 index 槽 sectionKey（stage 迁移后 id 跟新槽走）
      const itemId = slot.sectionKey;
      if (section.kind === "state") {
        const stateText = stateSectionText(context, section, locale);
        return [
          {
            cacheKey: JSON.stringify([
              itemId,
              locale,
              section.reason,
              stateText,
            ]),
            fileDisplay: fileDisplayForSlot(slot),
            id: itemId,
            kind: "ready-notice",
            ...(lineStats === undefined ? {} : { lineStats }),
            patch: null,
            ...(stageControl === null ? {} : { stageControl }),
            stateNotice: stateText,
          },
        ];
      }
      if (section.kind === "conflict") {
        const notice = conflictSectionText(context, section, locale);
        const fileLevelStage =
          (section.xy === "AA" || section.xy === "UU") &&
          section.presentation === "file-level" &&
          section.contents !== null
            ? { state: "unstaged" as const }
            : stageControl;
        return [
          {
            cacheKey: JSON.stringify([
              itemId,
              locale,
              section.kind,
              section.presentation,
              section.contentsDigest,
              section.xy,
              notice,
            ]),
            conflict: {
              contents: section.contents,
              contentsDigest: section.contentsDigest,
              presentation: section.presentation,
              stages: section.stages,
              xy: section.xy,
            },
            fileDisplay: fileDisplayForSlot(slot),
            id: itemId,
            kind: "conflict" as const,
            ...(lineStats === undefined ? {} : { lineStats }),
            patch: null,
            ...(fileLevelStage === null
              ? {}
              : { stageControl: fileLevelStage }),
            stateNotice: notice,
          },
        ];
      }
      if (section.kind === "image") {
        return [
          {
            cacheKey: JSON.stringify([
              "image",
              itemId,
              locale,
              section.before,
              section.after,
            ]),
            fileDisplay: fileDisplayForSlot(slot),
            id: itemId,
            imageDiff: {
              after: imageSideToView(section.gitRootPath, section.after),
              before: imageSideToView(section.gitRootPath, section.before),
            },
            kind: "image",
            ...(lineStats === undefined ? {} : { lineStats }),
            patch: null,
            ...(stageControl === null ? {} : { stageControl }),
          },
        ];
      }
      const changeControls =
        stageControl === null
          ? []
          : section.changeBlocks.flatMap((block) =>
              block.stageState === null
                ? []
                : [
                    {
                      canRevert: block.stageState !== "staged",
                      changeBlockIndex: block.changeBlockIndex,
                      changeKey: block.changeKey,
                      hunkIndex: block.hunkIndex,
                      state: block.stageState,
                    },
                  ]
            );
      const inlineThreads = comments?.get(slot.group, slot.targetPath) ?? [];
      const fileDrift = comments?.getFileDrift(slot.targetPath) ?? [];
      // patch 为空（estimate 阶段）跳过漂移判定：全行内乐观，loaded 后重判。
      const classified =
        inlineThreads.length > 0 && section.patch.length > 0
          ? classifyInlineDrift(inlineThreads, section.patch)
          : { drift: [] as PierDiffReviewDriftThread[], inline: inlineThreads };
      const driftThreads: PierDiffReviewDriftThread[] = [...classified.drift];
      for (const fileThread of fileDrift) {
        driftThreads.push(fileThread);
      }
      const reviewComments =
        classified.inline.length > 0 ? classified.inline : undefined;
      const driftComments = driftThreads.length > 0 ? driftThreads : undefined;
      return [
        {
          cacheKey: `git-review-section:${itemId}:${section.patch.length}:${fnv1a32(section.patch)}:${patchSidesFingerprint(section)}`,
          ...(changeControls.length === 0 ? {} : { changeControls }),
          ...(section.oldContents === undefined ||
          section.newContents === undefined
            ? {}
            : {
                diffFiles: {
                  newContents: section.newContents,
                  oldContents: section.oldContents,
                },
              }),
          fileDisplay: fileDisplayForSlot(slot),
          id: itemId,
          kind: "loaded",
          ...(lineStats === undefined ? {} : { lineStats }),
          patch: section.patch,
          ...(reviewComments === undefined ? {} : { reviewComments }),
          ...(driftComments === undefined ? {} : { driftComments }),
          ...(stageControl === null ? {} : { stageControl }),
        },
      ];
    });
  return { items: slotItems };
}

function fileDisplayForSlot(
  slot: ReviewSlot
): NonNullable<PierDiffViewItem["fileDisplay"]> {
  return {
    path: slot.targetPath,
    status: slot.status,
    ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
  };
}

function imageSideToView(
  gitRootPath: string,
  side: GitReviewImageSide | null
): PierImageDiffSide | null {
  if (side === null) {
    return null;
  }
  const locator =
    side.kind === "worktree"
      ? {
          absolutePath: side.absolutePath,
          kind: "absolute" as const,
          mime: side.mime,
          revision: side.revision,
        }
      : {
          gitRoot: gitRootPath,
          kind: "blob" as const,
          mime: side.mime,
          oid: side.oid,
          revision: side.oid,
        };
  return {
    byteSize: side.byteSize,
    height: side.height,
    locator,
    width: side.width,
  };
}

/**
 * Conflict slots prefer a real conflict section over a leftover patch
 * (soft-retain / mismatched sectionKey). Missing conflict body still
 * falls through to the shared patch fallback.
 */
function fallbackConflictSection(
  document: Extract<GitReviewDocumentResource, { kind: "loaded" }>["document"],
  sections: ReadonlyMap<string, (typeof document.sections)[number]>
): (typeof document.sections)[number] | undefined {
  const hinted = document.surfaceSections.head;
  if (hinted !== null) {
    const fromHead = sections.get(hinted);
    if (fromHead?.kind === "conflict") {
      return fromHead;
    }
  }
  return document.sections.find((section) => section.kind === "conflict");
}

/**
 * soft-retain 跨 stage 时 document.sections 仍是旧 sectionKey。
 * item id 用**当前** slot.sectionKey；正文借用可匹配的旧 section。
 */
function fallbackSectionForSlot(
  document: Extract<GitReviewDocumentResource, { kind: "loaded" }>["document"],
  slot: ReviewSlot,
  sections: ReadonlyMap<string, (typeof document.sections)[number]>
): (typeof document.sections)[number] | undefined {
  if (sections.size === 0) {
    return;
  }
  if (slot.group === "conflict") {
    const conflictSection = fallbackConflictSection(document, sections);
    if (conflictSection !== undefined) {
      return conflictSection;
    }
  }
  // 优先 surfaceSections 提示
  let surfaceHint: string | null | undefined;
  if (slot.group === "staged") {
    surfaceHint = document.surfaceSections.staged;
  } else if (slot.group === "unstaged") {
    surfaceHint = document.surfaceSections.index;
  } else if (slot.group === "conflict") {
    surfaceHint = null;
  } else {
    surfaceHint = document.surfaceSections.committed;
  }
  if (surfaceHint !== null && surfaceHint !== undefined) {
    const hinted = sections.get(surfaceHint);
    if (hinted !== undefined) {
      return hinted;
    }
  }
  const patchSections = document.sections.filter(
    (section) => section.kind === "patch"
  );
  if (patchSections.length === 1) {
    return patchSections[0];
  }
  // 半暂存 2 段：优先 stageState 与目标 group 一致的 patch
  let stageStateWanted: "staged" | "unstaged" | null = null;
  if (slot.group === "staged") {
    stageStateWanted = "staged";
  } else if (slot.group === "unstaged") {
    stageStateWanted = "unstaged";
  }
  if (stageStateWanted !== null) {
    const byStage = patchSections.find((section) =>
      section.changeBlocks.some(
        (block) => block.stageState === stageStateWanted
      )
    );
    if (byStage !== undefined) {
      return byStage;
    }
  }
  // 仍无匹配：任意唯一非 image 段，或首个 patch（总比空 estimate 好）
  if (document.sections.length === 1) {
    const only = document.sections[0];
    if (only !== undefined && only.kind !== "image") {
      return only;
    }
  }
  return patchSections[0];
}

function fnv1a32(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a unsigned coerce
  return (hash >>> 0).toString(16);
}

function patchSidesFingerprint(section: {
  readonly newContents?: string | undefined;
  readonly oldContents?: string | undefined;
}): string {
  if (section.oldContents === undefined || section.newContents === undefined) {
    return "partial";
  }
  return `${section.oldContents.length}:${section.newContents.length}:${fnv1a32(section.oldContents)}:${fnv1a32(section.newContents)}`;
}
