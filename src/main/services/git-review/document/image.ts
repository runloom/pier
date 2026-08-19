import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { filePreviewImageMimeSchema } from "../../../../shared/contracts/file.ts";
import type {
  GitReviewImageSection,
  GitReviewImageSide,
} from "../../../../shared/contracts/git/review.ts";
import { isPreviewableReviewImagePath } from "../../../../shared/git-review/previewable-image.ts";
import { resolveAbsoluteImagePreview } from "../../../files/absolute-image-preview.ts";
import { resolveGitBlobImagePreview } from "../../../files/git-blob-image-preview.ts";
import { readPreviewImageDimensions } from "../../../files/image-metadata.ts";
import type { GitReviewIndexGroupFact } from "../index/contract.ts";
import { GitReviewPathError } from "../path/contract.ts";
import { assertContained, resolveCanonicalRoot } from "../path/path-helpers.ts";
import type {
  GitReviewRenderableGroup,
  ReadGitReviewPatchOptions,
} from "./patch-contract.ts";

const GIT_BLOB_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export async function tryGitReviewImageSection(options: {
  readonly fact: GitReviewIndexGroupFact;
  readonly group: GitReviewRenderableGroup;
  readonly patchOptions: ReadGitReviewPatchOptions;
  readonly sectionKey: string;
}): Promise<GitReviewImageSection | null> {
  if (options.fact.status === "conflicted") {
    return null;
  }
  if (
    !isPreviewableReviewImagePath(options.fact.targetPath) &&
    (options.fact.oldPath === null ||
      !isPreviewableReviewImagePath(options.fact.oldPath))
  ) {
    return null;
  }
  const probeWorktree = shouldProbeWorktree(options.group, options.fact.status);
  const beforeOid = presentOid(options.fact.sourceOid);
  const afterOid = probeWorktree ? null : presentOid(options.fact.targetOid);
  const before =
    beforeOid === null
      ? null
      : await tryBlobImageSide(options.patchOptions, beforeOid);
  let after: GitReviewImageSide | null = null;
  if (probeWorktree) {
    after = await tryWorktreeImageSide(
      options.patchOptions,
      options.fact.targetPath
    );
  } else if (afterOid !== null) {
    after = await tryBlobImageSide(options.patchOptions, afterOid);
  }
  if (before === null && after === null) {
    return null;
  }
  return {
    after,
    before,
    gitRootPath: options.patchOptions.gitRootPath,
    kind: "image",
    oldPath: options.fact.oldPath,
    sectionKey: options.sectionKey,
    status: options.fact.status,
    targetPath: options.fact.targetPath,
  };
}

export function gitReviewImageSectionRevision(
  section: GitReviewImageSection
): string {
  return JSON.stringify({
    after: gitReviewImageSideRevision(section.after),
    before: gitReviewImageSideRevision(section.before),
  });
}

export function gitReviewImageSideRevision(
  side: GitReviewImageSide | null
): string | null {
  if (side === null) {
    return null;
  }
  return side.kind === "blob" ? side.oid : side.revision;
}

function shouldProbeWorktree(
  group: GitReviewRenderableGroup,
  status: GitReviewIndexGroupFact["status"]
): boolean {
  return (group === "unstaged" || group === "working") && status !== "deleted";
}

function presentOid(oid: string | null): string | null {
  if (oid === null || !GIT_BLOB_OID_PATTERN.test(oid) || /^0+$/u.test(oid)) {
    return null;
  }
  return oid;
}

async function tryBlobImageSide(
  options: ReadGitReviewPatchOptions,
  oid: string
): Promise<GitReviewImageSide | null> {
  const preview = await resolveGitBlobImagePreview({
    budget: options.budget,
    execGitRaw: options.execGitRaw,
    gitRoot: options.gitRootPath,
    oid,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!preview.ok) {
    return null;
  }
  return {
    byteSize: preview.byteSize,
    height: preview.height,
    kind: "blob",
    mime: preview.mime,
    oid,
    width: preview.width,
  };
}

async function tryWorktreeImageSide(
  options: ReadGitReviewPatchOptions,
  relativePath: string
): Promise<GitReviewImageSide | null> {
  if (options.signal?.aborted === true) {
    return null;
  }
  try {
    const canonicalRoot = await resolveCanonicalRoot(
      options.gitRootPath,
      options.signal,
      options.budget
    );
    const target = resolve(canonicalRoot, relativePath);
    if (!isAbsolute(target)) {
      return null;
    }
    assertContained(canonicalRoot, target);
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      return null;
    }
    const preview = await resolveAbsoluteImagePreview(target);
    if (!preview.ok) {
      return null;
    }
    assertContained(canonicalRoot, preview.canonicalPath);
    const mime = filePreviewImageMimeSchema.safeParse(preview.locator.mime);
    if (!mime.success) {
      return null;
    }
    const dimensions = readPreviewImageDimensions(preview.bytes);
    return {
      absolutePath: preview.canonicalPath,
      byteSize: preview.bytes.length,
      height: dimensions?.height ?? null,
      kind: "worktree",
      mime: mime.data,
      revision: preview.locator.revision,
      width: dimensions?.width ?? null,
    };
  } catch (error) {
    if (
      (error instanceof GitReviewPathError && error.reason === "aborted") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    return null;
  }
}
