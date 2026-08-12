/**
 * Git patch 投影辅助：再导出 shared hunk / blob 解析，供 project-thread 使用。
 */
export {
  type HunkLineRange,
  type HunkLineRanges,
  lineInHunkRanges,
  parseHunkLineRanges as parseHunkLineRangesFromPatch,
} from "@shared/comments/hunk-ranges.ts";
export {
  parseBlobOidForSide,
  parsePatchBlobOids,
} from "@shared/comments/patch-blob.ts";
