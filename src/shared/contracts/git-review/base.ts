import { z } from "zod";
import {
  GIT_REVIEW_GROUP_ORDER,
  GIT_REVIEW_MAX_SECTIONS,
  GIT_REVIEW_STATUS_PRIORITY,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
  gitReviewSectionKeySchema,
  gitReviewWarningSchema,
} from "./primitives.ts";

export const gitReviewScopeSchema = z.strictObject({
  contextId: z.string().min(1).max(256),
  gitRootPath: gitReviewRootPathSchema,
});
export type GitReviewScope = z.infer<typeof gitReviewScopeSchema>;

export const gitReviewFileSourceSchema = gitReviewScopeSchema.extend({
  oldPaths: z.array(gitReviewRelativePathSchema).max(3),
  path: gitReviewRelativePathSchema,
});
export type GitReviewFileSource = z.infer<typeof gitReviewFileSourceSchema>;

type GitReviewFileSourceIdentityTuple = readonly [
  contextId: string,
  gitRootPath: string,
  path: string,
  oldPaths: readonly string[],
];

/**
 * 序列化已规范化的 source 值；gitRootPath 的 realpath/case canonicalization
 * 仍由 T2 main identity 所有者在调用前完成，renderer 不得把词法路径当授权身份。
 */
function getGitReviewFileSourceIdentityTuple(
  input: GitReviewFileSource
): GitReviewFileSourceIdentityTuple {
  const source = gitReviewFileSourceSchema.parse(input);
  return [source.contextId, source.gitRootPath, source.path, source.oldPaths];
}

export function getGitReviewFileSourceIdentity(
  source: GitReviewFileSource
): string {
  return JSON.stringify(getGitReviewFileSourceIdentityTuple(source));
}

export const gitReviewRenderSlotSchema = z.strictObject({
  group: z.enum(GIT_REVIEW_GROUP_ORDER),
  oldPath: gitReviewRelativePathSchema.nullable(),
  sectionKey: gitReviewSectionKeySchema,
  status: gitReviewFileStatusSchema,
  targetPath: gitReviewRelativePathSchema,
});

export const gitReviewIndexEntrySchema = z
  .strictObject({
    entryKey: z.string().min(1).max(512),
    oldPaths: z.array(gitReviewRelativePathSchema).max(3),
    path: gitReviewRelativePathSchema,
    renderSlots: z
      .array(gitReviewRenderSlotSchema)
      .min(1)
      .max(GIT_REVIEW_MAX_SECTIONS),
    status: gitReviewFileStatusSchema,
  })
  .superRefine((entry, context) => {
    const sectionKeys = new Set<string>();
    const groups = new Set<string>();
    let previousGroupIndex = -1;
    for (const [index, slot] of entry.renderSlots.entries()) {
      const groupIndex = GIT_REVIEW_GROUP_ORDER.indexOf(slot.group);
      if (sectionKeys.has(slot.sectionKey) || groups.has(slot.group)) {
        context.addIssue({
          code: "custom",
          message: "Render slots must have unique section keys and groups",
          path: ["renderSlots", index],
        });
      }
      if (groupIndex <= previousGroupIndex) {
        context.addIssue({
          code: "custom",
          message: "Render slots must follow Git review group order",
          path: ["renderSlots", index],
        });
      }
      if (
        slot.group === "conflict" &&
        (slot.oldPath !== null || slot.status !== "conflicted")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Conflict render slots require conflicted status and no old path",
          path: ["renderSlots", index],
        });
      }
      sectionKeys.add(slot.sectionKey);
      groups.add(slot.group);
      previousGroupIndex = groupIndex;
    }
    const aggregateStatus = GIT_REVIEW_STATUS_PRIORITY.find((status) =>
      entry.renderSlots.some((slot) => slot.status === status)
    );
    if (aggregateStatus !== entry.status) {
      context.addIssue({
        code: "custom",
        message:
          "Entry status must match the highest-priority render slot status",
        path: ["status"],
      });
    }
  });
export type GitReviewIndexEntry = z.infer<typeof gitReviewIndexEntrySchema>;

export const gitReviewIndexOkSchema = z.strictObject({
  entries: z.array(gitReviewIndexEntrySchema),
  kind: z.literal("ok"),
  warnings: z
    .array(gitReviewWarningSchema)
    .max(4)
    .refine(
      (warnings) =>
        new Set(warnings.map((warning) => warning.code)).size ===
        warnings.length,
      "Warning codes must be unique"
    ),
});
export type GitReviewIndexOk = z.infer<typeof gitReviewIndexOkSchema>;

export const gitReviewIndexResultSchema = z.union([
  gitReviewIndexOkSchema,
  gitReviewFailureSchema,
]);
export type GitReviewIndexResult = z.infer<typeof gitReviewIndexResultSchema>;
