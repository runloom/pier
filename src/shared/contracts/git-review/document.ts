import { z } from "zod";
import { gitReviewFileSourceSchema } from "./base.ts";
import {
  GIT_REVIEW_MAX_SECTIONS,
  gitReviewChangeKeySchema,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewOperationIdSchema,
  gitReviewRelativePathSchema,
  gitReviewRevisionSchema,
  gitReviewSectionKeySchema,
  gitReviewStageStateSchema,
} from "./primitives.ts";

const gitReviewChangeRangeSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
});

export const gitReviewChangeBlockSchema = z.strictObject({
  changeBlockIndex: z.number().int().nonnegative(),
  changeKey: gitReviewChangeKeySchema,
  headRange: gitReviewChangeRangeSchema,
  hunkIndex: z.number().int().nonnegative(),
  stageState: gitReviewStageStateSchema.nullable(),
  workingRange: gitReviewChangeRangeSchema,
});
export type GitReviewChangeBlock = z.infer<typeof gitReviewChangeBlockSchema>;

const gitReviewSectionBaseShape = {
  sectionKey: gitReviewSectionKeySchema,
};

const patchSectionSchema = z.strictObject({
  ...gitReviewSectionBaseShape,
  changeBlocks: z.array(gitReviewChangeBlockSchema),
  kind: z.literal("patch"),
  patch: z.string().min(1),
});

const gitReviewStateSectionSchema = z.strictObject({
  ...gitReviewSectionBaseShape,
  kind: z.literal("state"),
  oldPath: gitReviewRelativePathSchema.nullable(),
  reason: z.enum([
    "binary",
    "conflict",
    "symlink",
    "submodule",
    "invalidEncoding",
    "tooLarge",
    "readError",
  ]),
  status: gitReviewFileStatusSchema,
  targetPath: gitReviewRelativePathSchema,
});

export const gitReviewFileSectionSchema = z
  .discriminatedUnion("kind", [patchSectionSchema, gitReviewStateSectionSchema])
  .superRefine((section, context) => {
    if (section.kind !== "state") {
      return;
    }
    const conflict = section.reason === "conflict";
    if (conflict !== (section.status === "conflicted")) {
      context.addIssue({
        code: "custom",
        message: "Conflict reason and conflicted status must match",
      });
    }
    if (conflict && section.oldPath !== null) {
      context.addIssue({
        code: "custom",
        message: "Conflict state must not carry an old path",
      });
    } else if (section.status === "renamed" && section.oldPath === null) {
      context.addIssue({
        code: "custom",
        message: "Renamed state requires an old path",
      });
    } else if (section.status !== "renamed" && section.oldPath !== null) {
      context.addIssue({
        code: "custom",
        message: "Only renamed state may carry an old path",
      });
    }
  });
export type GitReviewFileSection = z.infer<typeof gitReviewFileSectionSchema>;

const gitReviewDocumentSectionsSchema = z
  .array(gitReviewFileSectionSchema)
  .min(1)
  .max(GIT_REVIEW_MAX_SECTIONS)
  .refine(
    (sections) =>
      new Set(sections.map((section) => section.sectionKey)).size ===
      sections.length,
    "Section keys must be unique"
  );

export const gitReviewFileDocumentRequestSchema = z.strictObject({
  operationId: gitReviewOperationIdSchema,
  /**
   * renderer 已持有的单文件内容修订。main 仍完成稳定读取，但内容相同
   * 时只返回 unchanged，避免通过 IPC 重发大型补丁。
   */
  previousRevision: gitReviewRevisionSchema.optional(),
  source: gitReviewFileSourceSchema,
});
export type GitReviewFileDocumentRequest = z.infer<
  typeof gitReviewFileDocumentRequestSchema
>;

export const gitReviewFileDocumentOkSchema = z
  .strictObject({
    entryKey: z.string().min(1).max(512),
    kind: z.literal("ok"),
    revision: gitReviewRevisionSchema,
    sections: gitReviewDocumentSectionsSchema,
    /**
     * 每个阅读面对应的 section。显式建模基线，renderer 不再根据 section
     * 顺序或 sectionKey 猜测 staged / index / head 的所有权。
     */
    surfaceSections: z.strictObject({
      committed: gitReviewSectionKeySchema.nullable(),
      head: gitReviewSectionKeySchema.nullable(),
      index: gitReviewSectionKeySchema.nullable(),
      staged: gitReviewSectionKeySchema.nullable(),
    }),
  })
  .superRefine((document, context) => {
    const sectionKeys = new Set(
      document.sections.map((section) => section.sectionKey)
    );
    for (const [surface, sectionKey] of Object.entries(
      document.surfaceSections
    )) {
      if (sectionKey !== null && !sectionKeys.has(sectionKey)) {
        context.addIssue({
          code: "custom",
          message: `Surface ${surface} must reference a document section`,
          path: ["surfaceSections", surface],
        });
      }
    }
  });
export type GitReviewFileDocumentOk = z.infer<
  typeof gitReviewFileDocumentOkSchema
>;

export const gitReviewFileDocumentResultSchema = z.union([
  gitReviewFileDocumentOkSchema,
  z.strictObject({
    kind: z.literal("unchanged"),
  }),
  gitReviewFailureSchema,
]);
export type GitReviewFileDocumentResult = z.infer<
  typeof gitReviewFileDocumentResultSchema
>;
