import type { GitReviewFileDocumentOk } from "@shared/contracts/git-review.ts";

export const GIT_REVIEW_MAX_RETAINED_BYTES = 32 * 1024 * 1024;
export const GIT_REVIEW_MAX_RETAINED_LINES = 200_000;
const GIT_REVIEW_DOCUMENT_STRUCTURE_BYTES = 256;

export interface GitReviewRetentionLimits {
  readonly maxRetainedBytes: number;
  readonly maxRetainedLines: number;
}

export function assertGitReviewRetentionLimits(
  limits: GitReviewRetentionLimits
): void {
  if (
    !(
      Number.isSafeInteger(limits.maxRetainedBytes) &&
      limits.maxRetainedBytes > 0 &&
      Number.isSafeInteger(limits.maxRetainedLines) &&
      limits.maxRetainedLines > 0
    )
  ) {
    throw new Error("Git Review document 常驻上限必须是正安全整数");
  }
}

interface GitReviewDocumentMetrics {
  readonly bytes: number;
  readonly lines: number;
}

const documentMetricsCache = new WeakMap<
  GitReviewFileDocumentOk,
  GitReviewDocumentMetrics
>();

/** 同一不可变文档只扫描一次，供单代加载器与跨代协调共享预算口径。 */
export function gitReviewDocumentMetrics(
  document: GitReviewFileDocumentOk
): GitReviewDocumentMetrics {
  const cached = documentMetricsCache.get(document);
  if (cached) {
    return cached;
  }
  const bytes = Math.max(
    GIT_REVIEW_DOCUMENT_STRUCTURE_BYTES,
    document.sections.reduce(
      (total, section) =>
        total + (section.kind === "patch" ? section.patch.length * 2 : 0),
      0
    )
  );
  let lines = 0;
  for (const section of document.sections) {
    if (section.kind !== "patch" || section.patch.length === 0) {
      continue;
    }
    for (let index = 0; index < section.patch.length; index += 1) {
      if (section.patch.charCodeAt(index) === 10) {
        lines += 1;
      }
    }
    if (!section.patch.endsWith("\n")) {
      lines += 1;
    }
  }
  const metrics = Object.freeze({ bytes, lines });
  documentMetricsCache.set(document, metrics);
  return metrics;
}

export function isGitReviewDocumentReservable(
  document: GitReviewFileDocumentOk
): boolean {
  const metrics = gitReviewDocumentMetrics(document);
  return (
    metrics.bytes < GIT_REVIEW_MAX_RETAINED_BYTES &&
    metrics.lines < GIT_REVIEW_MAX_RETAINED_LINES
  );
}
