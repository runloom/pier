import { z } from "zod";
import { filePreviewImageMimeSchema } from "../file.ts";
import { gitReviewFileSourceSchema } from "./base.ts";
import {
  GIT_REVIEW_MAX_SECTIONS,
  gitReviewChangeKeySchema,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewOperationIdSchema,
  gitReviewRelativePathSchema,
  gitReviewRevisionSchema,
  gitReviewRootPathSchema,
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

/**
 * Legacy empty conflict placeholder. New materialize path emits
 * {@link conflictSectionSchema}; keep for one transition until UnresolvedFile
 * host lands (see 2026-08-12-git-review-merge-conflict-unresolved-file-design).
 */
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

const gitBlobOidSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u, "Expected a full Git object OID");

const gitReviewImageSideBaseShape = {
  byteSize: z.number().int().nonnegative(),
  height: z.number().int().positive().nullable(),
  mime: filePreviewImageMimeSchema,
  width: z.number().int().positive().nullable(),
};

export const gitReviewImageSideSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...gitReviewImageSideBaseShape,
    kind: z.literal("blob"),
    oid: gitBlobOidSchema,
  }),
  z.strictObject({
    ...gitReviewImageSideBaseShape,
    absolutePath: z.string().min(1).max(4096),
    kind: z.literal("worktree"),
    revision: z.string().min(1),
  }),
]);
export type GitReviewImageSide = z.infer<typeof gitReviewImageSideSchema>;

const imageSectionSchema = z.strictObject({
  ...gitReviewSectionBaseShape,
  after: gitReviewImageSideSchema.nullable(),
  before: gitReviewImageSideSchema.nullable(),
  gitRootPath: gitReviewRootPathSchema,
  kind: z.literal("image"),
  oldPath: gitReviewRelativePathSchema.nullable(),
  status: gitReviewFileStatusSchema,
  targetPath: gitReviewRelativePathSchema,
});
export type GitReviewImageSection = z.infer<typeof imageSectionSchema>;

/** Porcelain v2 unmerged XY codes (git status --porcelain=v2). */
export const GIT_REVIEW_CONFLICT_XY = [
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
] as const;
export const gitReviewConflictXySchema = z.enum(GIT_REVIEW_CONFLICT_XY);
export type GitReviewConflictXy = z.infer<typeof gitReviewConflictXySchema>;

/**
 * How renderer should present a conflict section.
 * - markers-text: worktree has complete <<<<<<< / ======= / >>>>>>> markers
 * - file-level: unmerged without reliable markers (DD, modify/delete, …)
 * - binary / tooLarge / invalidEncoding / readError: non-text or unreadable
 */
export const GIT_REVIEW_CONFLICT_PRESENTATIONS = [
  "markers-text",
  "file-level",
  "binary",
  "tooLarge",
  "invalidEncoding",
  "readError",
] as const;
export const gitReviewConflictPresentationSchema = z.enum(
  GIT_REVIEW_CONFLICT_PRESENTATIONS
);
export type GitReviewConflictPresentation = z.infer<
  typeof gitReviewConflictPresentationSchema
>;

const conflictSectionSchema = z.strictObject({
  ...gitReviewSectionBaseShape,
  /**
   * Worktree UTF-8 text when presentation is markers-text; otherwise null
   * (avoids shipping large non-renderable bodies over IPC).
   */
  contents: z.string().nullable(),
  /** sha256:… of worktree bytes when readable; synthetic digest otherwise. */
  contentsDigest: z.string().min(1).max(128),
  kind: z.literal("conflict"),
  oldPath: z.null(),
  presentation: gitReviewConflictPresentationSchema,
  stages: z.strictObject({
    baseOid: z.string().nullable(),
    oursOid: z.string().nullable(),
    theirsOid: z.string().nullable(),
  }),
  status: z.literal("conflicted"),
  targetPath: gitReviewRelativePathSchema,
  xy: gitReviewConflictXySchema,
});

export const gitReviewFileSectionSchema = z
  .discriminatedUnion("kind", [
    patchSectionSchema,
    gitReviewStateSectionSchema,
    imageSectionSchema,
    conflictSectionSchema,
  ])
  .superRefine((section, context) => {
    if (section.kind === "conflict") {
      if (
        section.presentation === "markers-text" &&
        (section.contents === null || section.contents.length === 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "markers-text conflict requires non-empty contents",
          path: ["contents"],
        });
      }
      if (
        section.presentation !== "markers-text" &&
        section.contents !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Only markers-text conflict may carry worktree contents",
          path: ["contents"],
        });
      }
      return;
    }
    if (section.kind === "image") {
      if (section.before === null && section.after === null) {
        context.addIssue({
          code: "custom",
          message: "Image section requires at least one previewable side",
        });
      }
      if (section.status === "conflicted") {
        context.addIssue({
          code: "custom",
          message: "Image section cannot be conflicted",
        });
      }
      if (section.status === "renamed" && section.oldPath === null) {
        context.addIssue({
          code: "custom",
          message: "Renamed image requires an old path",
        });
      } else if (section.status !== "renamed" && section.oldPath !== null) {
        context.addIssue({
          code: "custom",
          message: "Only renamed image may carry an old path",
        });
      }
      return;
    }
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
