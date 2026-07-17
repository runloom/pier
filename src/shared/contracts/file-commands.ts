import { z } from "zod";
import {
  fileConfirmDurabilityRequestSchema,
  fileCopyRequestSchema,
  fileDraftsClaimLegacyRequestSchema,
  fileDraftsDeleteRequestSchema,
  fileDraftsGetRequestSchema,
  fileDraftsSetRequestSchema,
  fileExistsRequestSchema,
  fileInspectPathImpactRequestSchema,
  fileInspectWriteTargetRequestSchema,
  fileListRequestSchema,
  fileMkdirRequestSchema,
  fileMoveRequestSchema,
  fileOpenPathRequestSchema,
  fileReadDocumentRequestSchema,
  fileReadTextRequestSchema,
  fileRevealRequestSchema,
  fileStatRequestSchema,
  fileTrashRequestSchema,
  fileWriteDocumentRequestSchema,
  fileWriteTextRequestSchema,
} from "./file.ts";

export const fileCommandSchemas = [
  fileListRequestSchema.extend({
    type: z.literal("file.list"),
  }),
  fileReadTextRequestSchema.extend({
    type: z.literal("file.readText"),
  }),
  fileReadDocumentRequestSchema.extend({
    type: z.literal("file.readDocument"),
  }),
  fileWriteTextRequestSchema.extend({
    type: z.literal("file.writeText"),
  }),
  fileWriteDocumentRequestSchema.extend({
    type: z.literal("file.writeDocument"),
  }),
  fileInspectWriteTargetRequestSchema.extend({
    type: z.literal("file.inspectWriteTarget"),
  }),
  fileInspectPathImpactRequestSchema.extend({
    type: z.literal("file.inspectPathImpact"),
  }),
  fileConfirmDurabilityRequestSchema.extend({
    type: z.literal("file.confirmDurability"),
  }),
  fileMoveRequestSchema.extend({
    type: z.literal("file.move"),
  }),
  fileTrashRequestSchema.extend({
    type: z.literal("file.trash"),
  }),
  fileMkdirRequestSchema.extend({
    type: z.literal("file.mkdir"),
  }),
  fileExistsRequestSchema.extend({
    type: z.literal("file.exists"),
  }),
  fileStatRequestSchema.extend({
    type: z.literal("file.stat"),
  }),
  fileCopyRequestSchema.extend({
    type: z.literal("file.copy"),
  }),
  fileOpenPathRequestSchema.extend({
    type: z.literal("file.openPath"),
  }),
  fileRevealRequestSchema.extend({
    type: z.literal("file.reveal"),
  }),
  z.object({ type: z.literal("file.drafts.listKeys") }),
  z.object({ type: z.literal("file.drafts.listDiagnostics") }),
  fileDraftsGetRequestSchema.extend({
    type: z.literal("file.drafts.get"),
  }),
  fileDraftsSetRequestSchema.extend({
    type: z.literal("file.drafts.set"),
  }),
  fileDraftsDeleteRequestSchema.extend({
    type: z.literal("file.drafts.delete"),
  }),
  fileDraftsClaimLegacyRequestSchema.extend({
    type: z.literal("file.drafts.claimLegacy"),
  }),
] as const;
