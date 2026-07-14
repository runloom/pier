import { z } from "zod";
import {
  gitDiffPanelSourceSchema,
  gitReviewResolvedQuerySchema,
} from "./base.ts";
import {
  GIT_REVIEW_MAX_SECTIONS,
  gitReviewCountSchema,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewGroupSchema,
  gitReviewOperationIdSchema,
  gitReviewRelativePathSchema,
  gitReviewRenderableGroupSchema,
  gitReviewRevisionSchema,
  gitReviewSectionKeySchema,
  isGitReviewParserMetricsAdmitted,
  measureGitReviewParserText,
} from "./primitives.ts";

const sectionBaseShape = {
  additions: gitReviewCountSchema,
  byteSize: gitReviewCountSchema,
  deletions: gitReviewCountSchema,
  group: gitReviewGroupSchema,
  lineCount: gitReviewCountSchema,
  oldPath: gitReviewRelativePathSchema.nullable(),
  path: gitReviewRelativePathSchema,
  sectionKey: gitReviewSectionKeySchema,
  sourceRevision: gitReviewRevisionSchema,
  status: gitReviewFileStatusSchema,
};

const renderableSectionBaseShape = {
  ...sectionBaseShape,
  byteSize: z.number().int().safe().nonnegative(),
  group: gitReviewRenderableGroupSchema,
  lineCount: z.number().int().safe().nonnegative(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
};

const patchSectionSchema = z
  .strictObject({
    ...renderableSectionBaseShape,
    contextLines: z.number().int().nonnegative().max(1000),
    kind: z.literal("patch"),
    patch: z.string().min(1),
  })
  .superRefine((section, context) => {
    const metrics = measureGitReviewParserText(section.patch);
    if (!isGitReviewParserMetricsAdmitted(metrics)) {
      context.addIssue({
        code: "custom",
        message: "Patch exceeds the synchronous parser admission budget",
      });
    }
    if (
      section.byteSize !== metrics.byteSize ||
      section.lineCount !== metrics.lineCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Patch byteSize and lineCount must describe the admitted patch",
      });
    }
  });

const stateSectionSchema = z
  .strictObject({
    ...sectionBaseShape,
    kind: z.literal("state"),
    message: z.string().max(4096).nullable(),
    reason: z.enum([
      "binary",
      "conflict",
      "symlink",
      "submodule",
      "invalidEncoding",
      "tooLarge",
      "readError",
    ]),
  })
  .superRefine((section, context) => {
    const conflictFieldsMatch =
      section.group === "conflict" &&
      section.reason === "conflict" &&
      section.status === "conflicted";
    const hasConflictField =
      section.group === "conflict" ||
      section.reason === "conflict" ||
      section.status === "conflicted";
    if (hasConflictField && !conflictFieldsMatch) {
      context.addIssue({
        code: "custom",
        message: "Conflict state requires matching group, reason, and status",
      });
    }
  });

export const gitReviewFileSectionSchema = z.discriminatedUnion("kind", [
  patchSectionSchema,
  stateSectionSchema,
]);
export type GitReviewFileSection = z.infer<typeof gitReviewFileSectionSchema>;

const gitReviewDocumentSectionsSchema = z
  .array(z.union([patchSectionSchema, stateSectionSchema]))
  .min(1)
  .max(GIT_REVIEW_MAX_SECTIONS)
  .refine(
    (sections) =>
      new Set(sections.map((section) => section.sectionKey)).size ===
      sections.length,
    "Section keys must be unique"
  );

export const gitReviewFileDocumentRequestSchema = z
  .strictObject({
    clientHasDocument: z.boolean(),
    ifRevision: gitReviewRevisionSchema.nullable(),
    operationId: gitReviewOperationIdSchema,
    source: gitDiffPanelSourceSchema,
  })
  .refine(
    (request) => !request.clientHasDocument || request.ifRevision !== null,
    "clientHasDocument requires ifRevision"
  );
export type GitReviewFileDocumentRequest = z.infer<
  typeof gitReviewFileDocumentRequestSchema
>;

export const gitReviewFileDocumentOkSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  kind: z.literal("ok"),
  resolvedQuery: gitReviewResolvedQuerySchema,
  revision: gitReviewRevisionSchema,
  sections: gitReviewDocumentSectionsSchema,
  source: gitDiffPanelSourceSchema,
});
export type GitReviewFileDocumentOk = z.infer<
  typeof gitReviewFileDocumentOkSchema
>;

export const gitReviewFileDocumentResultSchema = z.union([
  gitReviewFileDocumentOkSchema,
  z.strictObject({
    kind: z.literal("notModified"),
    revision: gitReviewRevisionSchema,
    source: gitDiffPanelSourceSchema,
  }),
  z.strictObject({
    kind: z.literal("unchanged"),
    source: gitDiffPanelSourceSchema,
  }),
  gitReviewFailureSchema,
]);
export type GitReviewFileDocumentResult = z.infer<
  typeof gitReviewFileDocumentResultSchema
>;
