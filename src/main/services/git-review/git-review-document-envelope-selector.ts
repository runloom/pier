import { isUtf8 } from "node:buffer";
import type { GitReviewFileStatus } from "../../../shared/contracts/git-review.ts";
import {
  GIT_REVIEW_PATCH_MAX_BYTES,
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
} from "./git-review-document-patch-contract.ts";
import {
  GitReviewIndexExecutionError,
  type GitReviewIndexGroupFact,
} from "./git-review-index-contract.ts";

const DIFF_SECTION_MARKER = Buffer.from("\ndiff --git ", "ascii");
const DIFF_SECTION_PREFIX = Buffer.from("diff --git ", "ascii");
const GIT_REVIEW_PATCH_RAW_MAX_BYTES = 64 * 1024;

export interface GitReviewPatchEnvelope {
  readonly oldPath: string | null;
  readonly patch: Buffer;
  readonly sourceMode: string;
  readonly sourceOid: string;
  readonly statusCode: string;
  readonly targetMode: string;
  readonly targetOid: string;
  readonly targetPath: string;
}

type GitReviewPatchEnvelopeMetadata = Omit<GitReviewPatchEnvelope, "patch">;

/** 只保留目标 patch；全部 stdout 仍由 Git 执行预算计费。 */
export class GitReviewPatchEnvelopeSelector {
  readonly #fact: GitReviewIndexGroupFact;
  #failure: unknown;
  #metadata: readonly GitReviewPatchEnvelopeMetadata[] | null = null;
  #patchCarry = Buffer.alloc(0);
  #patchPrefixBytes = 0;
  #raw = Buffer.alloc(0);
  #sectionIndex = 0;
  #selectedIndex = -1;
  #selectedPatchBytes = 0;
  readonly #selectedPatchChunks: Buffer[] = [];

  constructor(fact: GitReviewIndexGroupFact) {
    this.#fact = fact;
  }

  push(chunk: Buffer): void {
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
    try {
      this.#push(chunk);
    } catch (error) {
      this.#failure = error;
      throw error;
    }
  }

  finish(): GitReviewPatchEnvelope {
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
    const metadata = this.#metadata;
    if (metadata === null) {
      throw new GitReviewDocumentProtocolError(
        "Git Review patch 缺少 raw envelope"
      );
    }
    this.#appendSelectedPatch(this.#patchCarry);
    if (this.#patchPrefixBytes < DIFF_SECTION_PREFIX.length) {
      throw new GitReviewDocumentProtocolError("Git Review patch 正文非法");
    }
    const sectionCount =
      this.#patchCarry.length === 0 && this.#sectionIndex === 0
        ? 0
        : this.#sectionIndex + 1;
    if (sectionCount !== metadata.length) {
      throw new GitReviewDocumentProtocolError(
        "Git Review raw metadata 与 patch 数量不一致"
      );
    }
    const selected = metadata[this.#selectedIndex];
    if (selected === undefined) {
      throw new GitReviewDocumentProtocolError("Git Review patch 选择失败");
    }
    const patch = Buffer.concat(
      this.#selectedPatchChunks,
      this.#selectedPatchBytes
    );
    assertPatchBody(patch);
    return Object.freeze({ ...selected, patch });
  }

  #push(chunk: Buffer): void {
    if (this.#metadata === null) {
      const combined = Buffer.concat([this.#raw, chunk]);
      const separator = combined.indexOf(Buffer.from([0, 0]));
      if (separator < 0) {
        if (combined.length > GIT_REVIEW_PATCH_RAW_MAX_BYTES) {
          throw new GitReviewDocumentProtocolError(
            "Git Review raw envelope 超过字节上限"
          );
        }
        this.#raw = combined;
        return;
      }
      if (separator > GIT_REVIEW_PATCH_RAW_MAX_BYTES) {
        throw new GitReviewDocumentProtocolError(
          "Git Review raw envelope 超过字节上限"
        );
      }
      const metadata = parsePatchMetadata(
        splitNulRecords(combined.subarray(0, separator))
      );
      const matches = metadata.flatMap((item, index) =>
        envelopeMatchesFact(item, this.#fact) ? [index] : []
      );
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
      this.#metadata = metadata;
      this.#selectedIndex = matches[0] ?? -1;
      this.#raw = Buffer.alloc(0);
      this.#pushPatch(combined.subarray(separator + 2));
      return;
    }
    this.#pushPatch(chunk);
  }

  #pushPatch(chunk: Buffer): void {
    this.#acceptPatchPrefix(chunk);
    let remaining = Buffer.concat([this.#patchCarry, chunk]);
    while (true) {
      const marker = remaining.indexOf(DIFF_SECTION_MARKER);
      if (marker < 0) {
        const retainedBytes = Math.min(
          DIFF_SECTION_MARKER.length - 1,
          remaining.length
        );
        const admittedBytes = remaining.length - retainedBytes;
        this.#appendSelectedPatch(remaining.subarray(0, admittedBytes));
        this.#patchCarry = Buffer.from(remaining.subarray(admittedBytes));
        return;
      }
      this.#appendSelectedPatch(remaining.subarray(0, marker + 1));
      this.#sectionIndex += 1;
      remaining = remaining.subarray(marker + 1);
    }
  }

  #acceptPatchPrefix(chunk: Buffer): void {
    if (this.#patchPrefixBytes >= DIFF_SECTION_PREFIX.length) {
      return;
    }
    const checkedBytes = Math.min(
      chunk.length,
      DIFF_SECTION_PREFIX.length - this.#patchPrefixBytes
    );
    for (let index = 0; index < checkedBytes; index += 1) {
      if (
        chunk[index] !== DIFF_SECTION_PREFIX[this.#patchPrefixBytes + index]
      ) {
        throw new GitReviewDocumentProtocolError("Git Review patch 正文非法");
      }
    }
    this.#patchPrefixBytes += checkedBytes;
  }

  #appendSelectedPatch(chunk: Buffer): void {
    if (this.#sectionIndex !== this.#selectedIndex || chunk.length === 0) {
      return;
    }
    this.#selectedPatchBytes += chunk.length;
    if (
      this.#selectedPatchBytes >
      GIT_REVIEW_PATCH_MAX_BYTES + GIT_REVIEW_PATCH_RAW_MAX_BYTES
    ) {
      throw new GitReviewIndexExecutionError(
        "output-limit",
        "Git Review 目标 patch 超过字节上限"
      );
    }
    this.#selectedPatchChunks.push(Buffer.from(chunk));
  }
}

export function selectGitReviewPatchEnvelope(
  stdout: Buffer,
  fact: GitReviewIndexGroupFact
): GitReviewPatchEnvelope {
  const separator = stdout.indexOf(Buffer.from([0, 0]));
  if (separator < 0) {
    throw new GitReviewDocumentProtocolError(
      "Git Review patch 缺少 raw envelope"
    );
  }
  const metadata = parsePatchMetadata(
    splitNulRecords(stdout.subarray(0, separator))
  );
  const patches = splitPatchSections(stdout.subarray(separator + 2));
  if (metadata.length !== patches.length) {
    throw new GitReviewDocumentProtocolError(
      "Git Review raw metadata 与 patch 数量不一致"
    );
  }
  const matches = metadata.flatMap((item, index) => {
    const patch = patches[index];
    return patch !== undefined && envelopeMatchesFact(item, fact)
      ? [{ ...item, patch }]
      : [];
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

function parsePatchMetadata(
  records: readonly Buffer[]
): GitReviewPatchEnvelopeMetadata[] {
  const metadata: GitReviewPatchEnvelopeMetadata[] = [];
  let index = 0;
  while (index < records.length) {
    const header = records[index];
    if (header === undefined || !isUtf8(header)) {
      throw new GitReviewDocumentProtocolError("Git Review raw metadata 非法");
    }
    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ACDMRT])(\d*)$/u.exec(
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
    const recordCount = moved ? 3 : 2;
    metadata.push({
      oldPath: oldPathBytes?.toString("utf8") ?? null,
      sourceMode: match[1] ?? "",
      sourceOid: match[3] ?? "",
      statusCode,
      targetMode: match[2] ?? "",
      targetOid: match[4] ?? "",
      targetPath: targetPathBytes.toString("utf8"),
    });
    index += recordCount;
  }
  return metadata;
}

function splitNulRecords(value: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === 0) {
      records.push(value.subarray(start, index));
      start = index + 1;
    }
  }
  records.push(value.subarray(start));
  return records;
}

function splitPatchSections(patch: Buffer): Buffer[] {
  assertPatchBody(patch);
  const starts = [0];
  let cursor = 0;
  while (true) {
    const next = patch.indexOf(DIFF_SECTION_MARKER, cursor);
    if (next < 0) {
      break;
    }
    starts.push(next + 1);
    cursor = next + DIFF_SECTION_MARKER.length;
  }
  return starts.map((start, index) =>
    patch.subarray(start, starts[index + 1] ?? patch.length)
  );
}

function assertPatchBody(patch: Buffer): void {
  if (
    patch.length === 0 ||
    !patch.subarray(0, 11).equals(Buffer.from("diff --git "))
  ) {
    throw new GitReviewDocumentProtocolError("Git Review patch 正文非法");
  }
}

function envelopeMatchesFact(
  envelope: GitReviewPatchEnvelopeMetadata,
  fact: GitReviewIndexGroupFact
): boolean {
  return (
    envelopeMatchesFactStatus(envelope.statusCode, fact) &&
    envelope.oldPath === fact.oldPath &&
    envelope.targetPath === fact.targetPath
  );
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
