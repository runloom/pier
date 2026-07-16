import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import type { GitReviewPatchEnvelope } from "./git-review-document-envelope-selector.ts";
import {
  GIT_REVIEW_PATCH_MAX_BYTES,
  type GitReviewPatchMaterial,
  type GitReviewPatchStateReason,
  type ReadGitReviewPatchOptions,
} from "./git-review-document-patch-contract.ts";

const GIT_BINARY_PATCH_LINE = Buffer.from("GIT binary patch", "ascii");
const GIT_REVIEW_PARSER_MAX_BYTES = 768 * 1024;
const GIT_REVIEW_PARSER_MAX_LINES = 20_000;
const GIT_REVIEW_PARSER_MAX_LINE_BYTES = 64 * 1024;
const BINARY_FILES_PREFIX = Buffer.from("Binary files ", "ascii");
const BINARY_FILES_SUFFIX = Buffer.from(" differ", "ascii");

export function materialFromGitReviewPatchEnvelope(
  envelope: GitReviewPatchEnvelope,
  options: ReadGitReviewPatchOptions
): GitReviewPatchMaterial {
  const sourceRevision = createSourceRevision(options, envelope.patch);
  if (envelope.sourceMode === "160000" || envelope.targetMode === "160000") {
    return createGitReviewPatchState("submodule", sourceRevision, envelope);
  }
  if (envelope.sourceMode === "120000" || envelope.targetMode === "120000") {
    return createGitReviewPatchState("symlink", sourceRevision, envelope);
  }
  const metrics = measurePatchBuffer(envelope.patch);
  if (metrics.binary) {
    return createGitReviewPatchState("binary", sourceRevision, envelope);
  }
  if (!isUtf8(envelope.patch)) {
    return createGitReviewPatchState(
      "invalidEncoding",
      sourceRevision,
      envelope
    );
  }
  if (
    envelope.patch.length > GIT_REVIEW_PATCH_MAX_BYTES ||
    !isPatchMetricsAdmitted(metrics)
  ) {
    return createGitReviewPatchState("tooLarge", sourceRevision, envelope);
  }
  const patch = envelope.patch.toString("utf8");
  return Object.freeze({
    kind: "patch" as const,
    patch,
    sourceOid: envelope.sourceOid,
    sourceRevision,
    targetOid: envelope.targetOid,
  });
}

export function createGitReviewPatchState(
  reason: GitReviewPatchStateReason,
  sourceRevision: string,
  oids?: {
    readonly patch?: Buffer;
    readonly sourceOid: string;
    readonly targetMode: string;
    readonly targetOid: string;
  }
): Extract<GitReviewPatchMaterial, { kind: "state" }> {
  return Object.freeze({
    kind: "state" as const,
    reason,
    sourceOid: oids?.sourceOid ?? null,
    sourceRevision: sourceRevision.startsWith("sha256:")
      ? sourceRevision
      : `sha256:${createHash("sha256").update(sourceRevision).digest("hex")}`,
    targetOid: oids?.targetOid ?? null,
  });
}

function createSourceRevision(
  options: ReadGitReviewPatchOptions,
  patch: Buffer
): string {
  return `sha256:${createHash("sha256")
    .update("pier.git-review.section.v1\0", "utf8")
    .update(options.group, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(options.fact), "utf8")
    .update("\0", "utf8")
    .update(patch)
    .digest("hex")}`;
}

function measurePatchBuffer(patch: Buffer): {
  binary: boolean;
  byteSize: number;
  lineCount: number;
  maxLineByteSize: number;
} {
  let binary = false;
  let lineCount = 0;
  let lineStart = 0;
  let maxLineByteSize = 0;
  for (let index = 0; index < patch.length; index += 1) {
    if (patch[index] !== 10) {
      continue;
    }
    const lineEnd =
      index > lineStart && patch[index - 1] === 13 ? index - 1 : index;
    binary ||= isBinaryProtocolLine(patch.subarray(lineStart, lineEnd));
    maxLineByteSize = Math.max(maxLineByteSize, lineEnd - lineStart);
    lineCount += 1;
    lineStart = index + 1;
  }
  if (patch.length > 0 && lineStart < patch.length) {
    binary ||= isBinaryProtocolLine(patch.subarray(lineStart));
    lineCount += 1;
    maxLineByteSize = Math.max(maxLineByteSize, patch.length - lineStart);
  }
  return {
    binary,
    byteSize: patch.length,
    lineCount,
    maxLineByteSize,
  };
}

function isPatchMetricsAdmitted(metrics: {
  readonly byteSize: number;
  readonly lineCount: number;
  readonly maxLineByteSize: number;
}): boolean {
  return (
    metrics.byteSize <= GIT_REVIEW_PARSER_MAX_BYTES &&
    metrics.lineCount <= GIT_REVIEW_PARSER_MAX_LINES &&
    metrics.maxLineByteSize <= GIT_REVIEW_PARSER_MAX_LINE_BYTES
  );
}

function isBinaryProtocolLine(line: Buffer): boolean {
  return (
    line.equals(GIT_BINARY_PATCH_LINE) ||
    (line.length >= BINARY_FILES_PREFIX.length + BINARY_FILES_SUFFIX.length &&
      line
        .subarray(0, BINARY_FILES_PREFIX.length)
        .equals(BINARY_FILES_PREFIX) &&
      line.subarray(-BINARY_FILES_SUFFIX.length).equals(BINARY_FILES_SUFFIX))
  );
}
