import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import type { GitReviewFileStatus } from "../../../shared/contracts/git-review.ts";
import { isGitReviewParserMetricsAdmitted } from "../../../shared/contracts/git-review.ts";
import {
  GIT_REVIEW_PATCH_MAX_BYTES,
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type GitReviewPatchStateReason,
  type ReadGitReviewPatchOptions,
} from "./git-review-document-patch-contract.ts";
import type { GitReviewIndexGroupFact } from "./git-review-index-contract.ts";

const GIT_BINARY_PATCH_LINE = Buffer.from("GIT binary patch", "ascii");
const BINARY_FILES_PREFIX = Buffer.from("Binary files ", "ascii");
const BINARY_FILES_SUFFIX = Buffer.from(" differ", "ascii");

export function materialFromGitReviewPatchEnvelope(
  stdout: Buffer,
  options: ReadGitReviewPatchOptions
): GitReviewPatchMaterial {
  const envelope = parsePatchEnvelope(stdout, options.fact);
  assertExpectedEnvelope(envelope, options.fact);
  const sourceRevision = createSourceRevision(options, envelope.patch);
  if (envelope.sourceMode === "160000" || envelope.targetMode === "160000") {
    return createGitReviewPatchState(
      "submodule",
      sourceRevision,
      null,
      null,
      null,
      envelope
    );
  }
  if (envelope.sourceMode === "120000" || envelope.targetMode === "120000") {
    return createGitReviewPatchState(
      "symlink",
      sourceRevision,
      null,
      null,
      null,
      envelope
    );
  }
  const metrics = measurePatchBuffer(envelope.patch);
  if (metrics.binary) {
    return createGitReviewPatchState(
      "binary",
      sourceRevision,
      metrics.byteSize,
      metrics.lineCount,
      null,
      envelope
    );
  }
  if (!isUtf8(envelope.patch)) {
    return createGitReviewPatchState(
      "invalidEncoding",
      sourceRevision,
      envelope.patch.length,
      null,
      null,
      envelope
    );
  }
  if (
    envelope.patch.length > GIT_REVIEW_PATCH_MAX_BYTES ||
    !isGitReviewParserMetricsAdmitted(metrics)
  ) {
    return createGitReviewPatchState(
      "tooLarge",
      sourceRevision,
      metrics.byteSize,
      metrics.lineCount,
      null,
      envelope
    );
  }
  const patch = envelope.patch.toString("utf8");
  const counts = countPatchChanges(patch);
  return Object.freeze({
    additions: counts.additions,
    byteSize: metrics.byteSize,
    deletions: counts.deletions,
    kind: "patch" as const,
    lineCount: metrics.lineCount,
    patch,
    sourceOid: envelope.sourceOid,
    sourceRevision,
    targetOid: envelope.targetOid,
  });
}

export function createGitReviewPatchState(
  reason: GitReviewPatchStateReason,
  sourceRevision: string,
  byteSize: number | null,
  lineCount: number | null,
  message: string | null,
  oids?: { readonly sourceOid: string; readonly targetOid: string }
): Extract<GitReviewPatchMaterial, { kind: "state" }> {
  return Object.freeze({
    byteSize,
    kind: "state" as const,
    lineCount,
    message: message?.slice(0, 4096) ?? null,
    reason,
    sourceOid: oids?.sourceOid ?? null,
    sourceRevision: sourceRevision.startsWith("sha256:")
      ? sourceRevision
      : `sha256:${createHash("sha256").update(sourceRevision).digest("hex")}`,
    targetOid: oids?.targetOid ?? null,
  });
}

interface PatchEnvelope {
  readonly oldPath: string | null;
  readonly patch: Buffer;
  readonly sourceMode: string;
  readonly sourceOid: string;
  readonly statusCode: string;
  readonly targetMode: string;
  readonly targetOid: string;
  readonly targetPath: string;
}

function parsePatchEnvelope(
  stdout: Buffer,
  fact: GitReviewIndexGroupFact
): PatchEnvelope {
  const separator = stdout.indexOf(Buffer.from([0, 0]));
  if (separator < 0) {
    throw new GitReviewDocumentProtocolError(
      "Git Review patch 缺少 raw envelope"
    );
  }
  const records = splitNulRecords(stdout.subarray(0, separator));
  const patch = stdout.subarray(separator + 2);
  const metadata = parsePatchMetadata(records);
  const patches = splitPatchSections(patch);
  if (metadata.length !== patches.length) {
    throw new GitReviewDocumentProtocolError(
      "Git Review raw metadata 与 patch 数量不一致"
    );
  }
  const matches = metadata.flatMap((item, index) => {
    const itemPatch = patches[index];
    if (itemPatch === undefined) {
      return [];
    }
    const envelope = { ...item, patch: itemPatch };
    return envelopeMatchesFact(envelope, fact) ? [envelope] : [];
  });
  if (matches.length === 0) {
    throw new GitReviewDocumentStaleError(
      "Git Review patch 与索引路径或状态不一致"
    );
  }
  if (matches.length !== 1) {
    throw new GitReviewDocumentProtocolError(
      "Git Review patch 包含重复目标文件"
    );
  }
  const selected = matches[0];
  if (selected === undefined) {
    throw new GitReviewDocumentProtocolError("Git Review patch 选择失败");
  }
  return selected;
}

type PatchEnvelopeMetadata = Omit<PatchEnvelope, "patch">;

function parsePatchMetadata(
  records: readonly Buffer[]
): PatchEnvelopeMetadata[] {
  const metadata: PatchEnvelopeMetadata[] = [];
  let index = 0;
  while (index < records.length) {
    const header = records[index];
    if (header === undefined || !isUtf8(header)) {
      throw new GitReviewDocumentProtocolError("Git Review raw metadata 非法");
    }
    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ACDMRT])([0-9]*)$/u.exec(
        header.toString("ascii")
      );
    const statusCode = match?.[5] ?? "";
    const score = match?.[6] ?? "";
    const numericScore = score.length === 0 ? null : Number(score);
    if (
      match === null ||
      (match[3]?.length ?? 0) !== (match[4]?.length ?? 0) ||
      ((statusCode === "R" || statusCode === "C") &&
        (!/^\d{1,3}$/u.test(score) || (numericScore ?? 101) > 100)) ||
      (statusCode !== "R" && statusCode !== "C" && score.length > 0)
    ) {
      throw new GitReviewDocumentProtocolError("Git Review raw metadata 非法");
    }
    const moved = statusCode === "R" || statusCode === "C";
    const oldPathBytes = moved ? records[index + 1] : null;
    const targetPathBytes = records[index + (moved ? 2 : 1)];
    if (
      targetPathBytes === undefined ||
      oldPathBytes === undefined ||
      !isUtf8(targetPathBytes) ||
      (oldPathBytes !== null && !isUtf8(oldPathBytes))
    ) {
      throw new GitReviewDocumentProtocolError("Git Review raw 路径无法解码");
    }
    metadata.push({
      oldPath: oldPathBytes?.toString("utf8") ?? null,
      sourceMode: match[1] ?? "",
      sourceOid: match[3] ?? "",
      statusCode,
      targetMode: match[2] ?? "",
      targetOid: match[4] ?? "",
      targetPath: targetPathBytes.toString("utf8"),
    });
    index += moved ? 3 : 2;
  }
  return metadata;
}

function splitPatchSections(patch: Buffer): Buffer[] {
  if (
    patch.length === 0 ||
    !patch.subarray(0, 11).equals(Buffer.from("diff --git "))
  ) {
    throw new GitReviewDocumentProtocolError("Git Review patch 正文非法");
  }
  const marker = Buffer.from("\ndiff --git ", "ascii");
  const starts = [0];
  let cursor = 0;
  while (true) {
    const next = patch.indexOf(marker, cursor);
    if (next < 0) {
      break;
    }
    starts.push(next + 1);
    cursor = next + marker.length;
  }
  return starts.map((start, index) =>
    patch.subarray(start, starts[index + 1] ?? patch.length)
  );
}

function envelopeMatchesFact(
  envelope: PatchEnvelope,
  fact: GitReviewIndexGroupFact
): boolean {
  return (
    envelopeMatchesFactStatus(envelope.statusCode, fact) &&
    envelope.oldPath === fact.oldPath &&
    envelope.targetPath === fact.targetPath
  );
}

function assertExpectedEnvelope(
  envelope: PatchEnvelope,
  fact: GitReviewIndexGroupFact
): void {
  const statusMatches = envelopeMatchesFactStatus(envelope.statusCode, fact);
  if (
    !statusMatches ||
    envelope.oldPath !== fact.oldPath ||
    envelope.targetPath !== fact.targetPath
  ) {
    throw new GitReviewDocumentStaleError(
      "Git Review patch 与索引路径或状态不一致"
    );
  }
}

function envelopeMatchesFactStatus(
  statusCode: string,
  fact: GitReviewIndexGroupFact
): boolean {
  if (fact.movement === "rename") {
    return statusCode === "R";
  }
  if (fact.movement === "copy") {
    return statusCode === "C";
  }
  return statusMatchesFileStatus(statusCode, fact.status);
}

function statusMatchesFileStatus(
  statusCode: string,
  status: GitReviewFileStatus
): boolean {
  if (status === "added") {
    return statusCode === "A";
  }
  if (status === "deleted") {
    return statusCode === "D";
  }
  if (status === "modified") {
    return statusCode === "M" || statusCode === "T";
  }
  return false;
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

function countPatchChanges(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  let lineStart = 0;
  for (let index = 0; index <= patch.length; index += 1) {
    if (index < patch.length && patch.charCodeAt(index) !== 10) {
      continue;
    }
    const line = patch.slice(lineStart, index);
    lineStart = index + 1;
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
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

function splitNulRecords(input: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== 0) {
      continue;
    }
    records.push(input.subarray(start, index));
    start = index + 1;
  }
  records.push(input.subarray(start));
  return records;
}
