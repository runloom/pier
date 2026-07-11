import { z } from "zod";
import { fileRootSchema, nonEmptyFileRootRelativePathSchema } from "./file.ts";
import { panelContextSchema } from "./panel.ts";

const windowsAbsolutePathPattern = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function isPortableAbsolutePath(path: string): boolean {
  return path.startsWith("/") || windowsAbsolutePathPattern.test(path);
}

const absolutePanelContextSchema = panelContextSchema
  .strict()
  .superRefine((panelContext, context) => {
    if (!isPortableAbsolutePath(panelContext.projectRootPath)) {
      context.addIssue({
        code: "custom",
        message: "Expected an absolute project root path",
        path: ["projectRootPath"],
      });
    }
  });

const absoluteFileRootSchema = fileRootSchema.refine(isPortableAbsolutePath, {
  message: "Expected an absolute file root path",
});

const suggestedFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      name !== "." &&
      name !== ".." &&
      !name.includes("/") &&
      !name.includes("\\") &&
      !name.includes("\0"),
    "Expected a file name without path separators"
  );

export const fileSaveTargetRequestSchema = z
  .object({
    context: absolutePanelContextSchema,
    suggestedName: suggestedFileNameSchema.optional(),
  })
  .strict();
export type FileSaveTargetRequest = z.infer<typeof fileSaveTargetRequestSchema>;

export const fileSaveTargetSchema = z
  .object({
    context: absolutePanelContextSchema,
    path: nonEmptyFileRootRelativePathSchema,
    root: absoluteFileRootSchema,
  })
  .strict()
  .superRefine((target, context) => {
    if (target.root !== target.context.projectRootPath) {
      context.addIssue({
        code: "custom",
        message: "Expected root to match the panel context project root",
        path: ["root"],
      });
    }
  });
export type FileSaveTarget = z.infer<typeof fileSaveTargetSchema>;

export const fileSaveTargetResultSchema = fileSaveTargetSchema.nullable();
export type FileSaveTargetResult = z.infer<typeof fileSaveTargetResultSchema>;
