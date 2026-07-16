import { z } from "zod";
import { gitReviewRootPathSchema } from "./git-review.ts";

export const gitWatchLeaseSchema = z
  .object({
    gitRoot: gitReviewRootPathSchema,
    leaseId: z.string().uuid(),
  })
  .strict();
export type GitWatchLease = z.infer<typeof gitWatchLeaseSchema>;

export const gitWatchStopRequestSchema = z
  .object({ leaseId: z.string().uuid() })
  .strict();
