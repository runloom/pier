import type { PierDiffViewItem } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { reviewStageControl } from "./git-review-document-estimates.ts";
import type { ReviewDocumentResourceProjection } from "./git-review-document-projection-types.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";
import { stateSectionText } from "./git-review-document-state-text.ts";

const loadedResourceProjectionCache = new WeakMap<
  object,
  Map<string, ReviewDocumentResourceProjection>
>();

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
  locale: string
): ReviewDocumentResourceProjection {
  if (!isCodeViewMemberResource(resource)) {
    return { items: [] };
  }
  if (resource.kind === "error") {
    return projectFailedReviewDocumentResource(resource, context);
  }
  let projectionsByKey = loadedResourceProjectionCache.get(context);
  if (projectionsByKey === undefined) {
    projectionsByKey = new Map();
    loadedResourceProjectionCache.set(context, projectionsByKey);
  }
  // 文档可能由 IPC 在每次权威刷新后重新物化，但 revision 是内容身份。
  // 按内容身份缓存可避免未变化大文件重复 hash patch、复制数千个 change block。
  const projectionKey = JSON.stringify([
    locale,
    resource.document.revision,
    resource.document.sections.map((section) =>
      section.kind === "patch"
        ? [
            section.sectionKey,
            section.patch.length,
            section.changeBlocks.length,
          ]
        : [section.sectionKey, section.kind, section.reason]
    ),
    resource.entry,
  ]);
  const cached = projectionsByKey.get(projectionKey);
  if (cached !== undefined) {
    return cached;
  }
  const projection = projectLoadedReviewDocumentResource(
    resource,
    context,
    locale
  );
  projectionsByKey.set(projectionKey, projection);
  return projection;
}

function projectFailedReviewDocumentResource(
  resource: Extract<GitReviewDocumentResource, { kind: "error" }>,
  context: RendererPluginContext
): ReviewDocumentResourceProjection {
  const notice = context.i18n.t(
    "ui.reviewDocumentLoadFailed",
    undefined,
    "Unable to load this change"
  );
  const slotItems = resource.entry.renderSlots.map((slot) => {
    const stageControl = reviewStageControl(slot.group, slot.status);
    return {
      cacheKey: `git-review-error:${slot.sectionKey}:${resource.failure.reason}`,
      fileDisplay: fileDisplayForSlot(slot),
      id: slot.sectionKey,
      kind: "error" as const,
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
  locale: string
): ReviewDocumentResourceProjection {
  const sections = new Map(
    resource.document.sections.map((section) => [section.sectionKey, section])
  );
  const slotItems = resource.entry.renderSlots.flatMap(
    (slot): PierDiffViewItem[] => {
      const section = sections.get(slot.sectionKey);
      if (section === undefined) {
        return [];
      }
      const stageControl = reviewStageControl(slot.group, slot.status);
      if (section.kind === "state") {
        const stateText = stateSectionText(context, section, locale);
        return [
          {
            cacheKey: JSON.stringify([
              section.sectionKey,
              locale,
              section.reason,
              stateText,
            ]),
            fileDisplay: fileDisplayForSlot(slot),
            id: section.sectionKey,
            kind: "ready-notice",
            patch: null,
            ...(stageControl === null ? {} : { stageControl }),
            stateNotice: stateText,
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
      return [
        {
          cacheKey: `git-review-section:${section.sectionKey}:${section.patch.length}:${fnv1a32(section.patch)}`,
          ...(changeControls.length === 0 ? {} : { changeControls }),
          fileDisplay: fileDisplayForSlot(slot),
          id: section.sectionKey,
          kind: "loaded",
          patch: section.patch,
          ...(stageControl === null ? {} : { stageControl }),
        },
      ];
    }
  );
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
