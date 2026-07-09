import { z } from "zod";
import {
  fileCopyRequestSchema,
  fileDraftsDeleteRequestSchema,
  fileDraftsSetRequestSchema,
  fileExistsRequestSchema,
  fileListRequestSchema,
  fileMkdirRequestSchema,
  fileMoveRequestSchema,
  fileReadTextRequestSchema,
  fileRevealRequestSchema,
  fileStatRequestSchema,
  fileTrashRequestSchema,
  fileWriteTextRequestSchema,
} from "./file.ts";

export const fileCommandSchemas = [
  fileListRequestSchema.extend({
    type: z.literal("file.list"),
  }),
  fileReadTextRequestSchema.extend({
    type: z.literal("file.readText"),
  }),
  fileWriteTextRequestSchema.extend({
    type: z.literal("file.writeText"),
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
  fileRevealRequestSchema.extend({
    type: z.literal("file.reveal"),
  }),
  z.object({ type: z.literal("file.drafts.list") }),
  fileDraftsSetRequestSchema.extend({
    type: z.literal("file.drafts.set"),
  }),
  fileDraftsDeleteRequestSchema.extend({
    type: z.literal("file.drafts.delete"),
  }),
] as const;
