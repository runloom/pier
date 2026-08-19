import type { FileDiffMetadata } from "@pierre/diffs";
import { estimateContentLinesFromLineStats } from "../geometry.ts";

interface PlaceholderFileDisplay {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: "added" | "conflicted" | "deleted" | "modified" | "renamed";
}

interface PlaceholderItem {
  readonly cacheKey: string;
  readonly fileDisplay?: PlaceholderFileDisplay;
  readonly id: string;
  readonly lineStats?: {
    readonly additions: number;
    readonly deletions: number;
  };
}

function fileDisplayType(
  status: PlaceholderFileDisplay["status"]
): FileDiffMetadata["type"] {
  switch (status) {
    case "added":
      return "new";
    case "deleted":
      return "deleted";
    case "renamed":
      return "rename-changed";
    case "conflicted":
    case "modified":
      return "change";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * estimate 槽：FileDiff **0 正文行**（禁止假行号 / unmodified 假文件体）。
 *
 * 虚拟高度唯一来源：`geometry.slotVirtualHeight`（折叠=header，未折叠=numstat 预留或骨架）。
 * 折叠全部事务负责全表写 H，禁止靠滚动收敛。
 * 水合后以真 patch 为准。**禁止** isPartial（见 DiffHunks null 行崩溃）。
 */
export function estimateFileDiff(input: PlaceholderItem): FileDiffMetadata {
  const display = input.fileDisplay;
  if (!display) {
    throw new Error(`Pierre estimate is missing file display: ${input.id}`);
  }
  const fileDiff: FileDiffMetadata = {
    additionLines: [],
    cacheKey: input.cacheKey,
    deletionLines: [],
    hunks: [],
    isPartial: false,
    name: display.path,
    ...(display.previousPath === undefined
      ? {}
      : { prevName: display.previousPath }),
    splitLineCount: 0,
    type: "change",
    unifiedLineCount: 0,
  };
  const contentLines = estimateContentLinesFromLineStats(input.lineStats);
  if (contentLines !== undefined) {
    Object.assign(fileDiff, { estimatedContentLines: contentLines });
  }
  return fileDiff;
}

/** 是否为 estimate 占位 FileDiff（0 正文、cacheKey 前缀）。 */
export function isEstimateCodeViewItem(
  item:
    | {
        readonly fileDiff?: { readonly cacheKey?: string };
        readonly type?: string;
      }
    | undefined
): boolean {
  if (item === undefined || item.type !== "diff") {
    return false;
  }
  return (
    typeof item.fileDiff?.cacheKey === "string" &&
    item.fileDiff.cacheKey.startsWith("estimate:")
  );
}

/** error / ready-notice：仅 header 几何（0 正文行），presentation 靠 stateNotice。 */
export function noticeFileDiff(input: PlaceholderItem): FileDiffMetadata {
  const display = input.fileDisplay;
  if (!display) {
    throw new Error(`Pierre notice item is missing file display: ${input.id}`);
  }
  return {
    additionLines: [],
    cacheKey: input.cacheKey,
    deletionLines: [],
    hunks: [],
    isPartial: false,
    name: display.path,
    ...(display.previousPath === undefined
      ? {}
      : { prevName: display.previousPath }),
    splitLineCount: 0,
    type: fileDisplayType(display.status),
    unifiedLineCount: 0,
  };
}

/** @deprecated 使用 estimateFileDiff；保留别名避免外部误引用旧名。 */
export function placeholderFileDiff(input: PlaceholderItem): FileDiffMetadata {
  return estimateFileDiff(input);
}
