import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createGitReviewTemporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pier-git-review-"));
}

export function removeGitReviewTemporaryRoot(path: string): Promise<void> {
  return rm(path, { force: true, recursive: true });
}
