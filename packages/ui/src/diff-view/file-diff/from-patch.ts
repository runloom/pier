import { type FileDiffMetadata, processFile } from "@pierre/diffs";

interface PatchFileDiffInput {
  readonly cacheKey: string;
  readonly diffFiles?: {
    readonly newContents: string;
    readonly oldContents: string;
  };
  readonly fileName?: string;
  readonly id: string;
  readonly patch: string | null;
}

/**
 * Pierre `processFile` without oldFile/newFile sets `isPartial=true`: the
 * patch only has hunk-fragment line buffers. Expanding collapsed unmodified
 * lines then reads past those buffers (`undefinedundefined…`).
 *
 * When both sides are present, pass them through so `isPartial=false` and the
 * "N 行未修改" separator is clickable — same as UnresolvedFile (full file).
 * Missing sides must stay partial; never clear the flag by hand.
 */
export function parsePatchFileDiff(
  input: PatchFileDiffInput
): FileDiffMetadata {
  if (input.patch === null) {
    throw new Error(`Pierre diff item has no patch: ${input.id}`);
  }
  const sides = input.diffFiles;
  const fileName = input.fileName ?? input.id;
  const parsed = processFile(input.patch, {
    cacheKey: input.cacheKey,
    isGitDiff: true,
    throwOnError: true,
    ...(sides === undefined
      ? {}
      : {
          newFile: {
            contents: sides.newContents,
            name: fileName,
          },
          oldFile: {
            contents: sides.oldContents,
            name: fileName,
          },
        }),
  });
  if (!parsed) {
    throw new Error(`Pierre did not parse diff item: ${input.id}`);
  }
  return assertPatchHunkBuffersCovered(parsed);
}

/**
 * 校验 FileDiff 的 hunk 行缓冲完整。
 * 无 sides 时 **保持 isPartial**（片段 patch ≠ 全文）。
 * - 0 hunk：合法空正文（mode-only 等），不 throw
 * - 有 hunk 但索引越界：throw → error notice
 *
 * @deprecated 旧名 markSelfContainedPatchComplete 曾错误清 isPartial；请改用本函数。
 */
export function assertPatchHunkBuffersCovered(
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  if (fileDiff.hunks.length === 0) {
    return fileDiff;
  }
  if (!patchLineBuffersCoverHunks(fileDiff)) {
    throw new Error(
      `Pierre patch line buffers do not cover hunks: ${fileDiff.name || fileDiff.cacheKey || "unknown"}`
    );
  }
  return fileDiff;
}

/** @deprecated Use {@link assertPatchHunkBuffersCovered}. */
export function markSelfContainedPatchComplete(
  fileDiff: FileDiffMetadata
): FileDiffMetadata {
  return assertPatchHunkBuffersCovered(fileDiff);
}

/** true = 每个 hunk 的行索引落在 addition/deletion 缓冲内。0 hunk 视为 true。 */
function patchLineBuffersCoverHunks(fileDiff: FileDiffMetadata): boolean {
  for (const hunk of fileDiff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        const endAdd = content.additionLineIndex + content.lines;
        const endDel = content.deletionLineIndex + content.lines;
        if (
          endAdd > fileDiff.additionLines.length ||
          endDel > fileDiff.deletionLines.length
        ) {
          return false;
        }
        continue;
      }
      if (content.type === "change") {
        if (
          content.additions > 0 &&
          content.additionLineIndex + content.additions >
            fileDiff.additionLines.length
        ) {
          return false;
        }
        if (
          content.deletions > 0 &&
          content.deletionLineIndex + content.deletions >
            fileDiff.deletionLines.length
        ) {
          return false;
        }
      }
    }
  }
  return true;
}
