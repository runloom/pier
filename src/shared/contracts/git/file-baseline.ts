import { z } from "zod";

/** Paths are resolved relative to root; absolute paths must remain inside root. */
export const gitFileBaselineInputSchema = z.strictObject({
  root: z
    .string()
    .min(1)
    .max(32_768)
    .refine((value) => !value.includes("\0")),
  path: z
    .string()
    .min(1)
    .max(32_768)
    .refine((value) => !value.includes("\0")),
});

export type GitFileBaselineInput = z.infer<typeof gitFileBaselineInputSchema>;

/** HEAD → Files document: UTF-8 text, without BOM, with LF line endings. */
export type GitFileBaselineResult =
  | {
      status: "ready";
      gitRoot: string;
      /** Normalized path relative to gitRoot, including for a subdirectory root. */
      path: string;
      /** Original path from git status when the file was renamed. */
      basePath: string;
      headOid: string | null;
      contents: string;
      existsAtHead: boolean;
    }
  | {
      status: "unavailable";
      reason:
        | "not-repository"
        | "binary"
        | "too-large"
        | "unsupported-encoding"
        | "unsupported-file";
    }
  | { status: "error"; message: string };
