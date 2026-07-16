import { createHash } from "node:crypto";
import type { GitReviewGroup } from "../../../shared/contracts/git-review.ts";

export function createGitReviewSectionKey(
  group: GitReviewGroup,
  oldPath: string | null,
  targetPath: string
): string {
  const digest = createHash("sha256");
  for (const part of [
    "pier.git-review.section-key.v1",
    group,
    oldPath ?? "",
    targetPath,
  ]) {
    digest.update(part, "utf8");
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}
