import {
  type GitReviewScope,
  gitReviewScopeSchema,
} from "@shared/contracts/git/review.ts";
import { GIT_REVIEW_GROUP_ORDER } from "@shared/contracts/git-review/primitives.ts";
import { z } from "zod";
import type { PendingCommentReveal } from "./surface-types.ts";

const pendingCommentRevealSchema = z
  .strictObject({
    allowGroupFallback: z.boolean().optional(),
    group: z.enum(GIT_REVIEW_GROUP_ORDER).optional(),
    line: z.number().int().positive(),
    nonce: z.number().int().nonnegative(),
    path: z.string().min(1),
    side: z.enum(["new", "old"]),
  })
  .superRefine((value, ctx) => {
    // 评论：必须有 group 且不可 fallback；gutter：allowGroupFallback 时可无 group。
    if (!value.allowGroupFallback && value.group === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "group is required when allowGroupFallback is not true",
        path: ["group"],
      });
    }
  });

export function readGitReviewScope(params: unknown): GitReviewScope | null {
  if (!(params && typeof params === "object" && "source" in params)) {
    return null;
  }
  const parsed = gitReviewScopeSchema.safeParse(
    (params as { source: unknown }).source
  );
  return parsed.success ? parsed.data : null;
}

export function readPendingReveal(
  params: unknown
): PendingCommentReveal | null {
  if (!(params && typeof params === "object" && "pendingReveal" in params)) {
    return null;
  }
  const parsed = pendingCommentRevealSchema.safeParse(
    (params as { pendingReveal: unknown }).pendingReveal
  );
  if (!parsed.success) {
    return null;
  }
  const value = parsed.data;
  return {
    line: value.line,
    nonce: value.nonce,
    path: value.path,
    side: value.side,
    ...(value.allowGroupFallback === true
      ? { allowGroupFallback: true as const }
      : {}),
    ...(value.group === undefined ? {} : { group: value.group }),
  };
}
