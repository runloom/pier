import { z } from "zod";
import { gitReviewFileSourceSchema } from "./base.ts";
import {
  GIT_REVIEW_MAX_SECTIONS,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewOperationIdSchema,
  gitReviewRelativePathSchema,
  gitReviewRevisionSchema,
  gitReviewSectionKeySchema,
} from "./primitives.ts";

const gitReviewSectionBaseShape = {
  sectionKey: gitReviewSectionKeySchema,
};

const patchSectionSchema = z.strictObject({
  ...gitReviewSectionBaseShape,
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
  source: gitReviewFileSourceSchema,
});
export type GitReviewFileDocumentRequest = z.infer<
  typeof gitReviewFileDocumentRequestSchema
>;

export const gitReviewFileDocumentOkSchema = z.strictObject({
  kind: z.literal("ok"),
  revision: gitReviewRevisionSchema,
  sections: gitReviewDocumentSectionsSchema,
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
