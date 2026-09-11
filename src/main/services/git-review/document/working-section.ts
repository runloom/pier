import type {
  GitReviewChangeBlock,
  GitReviewFileSection,
  GitReviewFileSource,
  GitReviewFileStatus,
  GitReviewStageState,
} from "../../../../shared/contracts/git/review.ts";
import type { GitReviewIndexResolvedEntry } from "../index/assembler.ts";
import type {
  GitReviewPatchBacking,
  GitReviewRenderableFact,
} from "./patch-contract.ts";

/**
 * 派生组合阅读面（working）的全部规则。
 *
 * working 段表示「该路径组相对 HEAD 的全部未提交变化」，由 staged / unstaged 槽派生，
 * 没有自己的 index 槽。因此：
 *
 * - 它不参与「改动存在」的证明：git 给不出单一记录时该面缺席，不产生失败也不重试；
 * - 它没有工作区槽：工作区侧不存在就没有可 fence 的正文，文件不在工作区不是陈旧事实。
 *
 * 槽背书分组（staged / unstaged / committed / conflict）的规则不在这里。
 */
export interface WorkingSectionInput {
  readonly entry: { readonly status: GitReviewFileStatus };
  readonly resolvedEntry: {
    readonly groupFacts: GitReviewIndexResolvedEntry["groupFacts"];
  };
  readonly source: GitReviewFileSource;
}

export function createWorkingFact(
  input: WorkingSectionInput
): GitReviewRenderableFact | null {
  if (input.source.target.kind !== "uncommitted") {
    return null;
  }
  const staged = input.resolvedEntry.groupFacts.staged;
  const unstaged = input.resolvedEntry.groupFacts.unstaged;
  if (staged === undefined && unstaged === undefined) {
    return null;
  }
  if (input.entry.status === "conflicted") {
    return null;
  }
  const status: Exclude<GitReviewFileStatus, "conflicted"> = input.entry.status;
  const first = staged ?? unstaged;
  if (first === undefined) {
    return null;
  }
  return {
    conflict: null,
    movement: staged?.movement ?? unstaged?.movement ?? null,
    oldPath: staged?.oldPath ?? unstaged?.oldPath ?? null,
    origin:
      staged === undefined && unstaged?.origin === "untracked"
        ? "untracked"
        : "tracked",
    sourceOid: staged?.sourceOid ?? unstaged?.sourceOid ?? null,
    statsExpected: staged?.statsExpected ?? unstaged?.statsExpected ?? true,
    status,
    targetOid: null,
    targetPath: unstaged?.targetPath ?? staged?.targetPath ?? first.targetPath,
  };
}

/** unstaged 事实（缺失时退回 staged）描述工作区侧：deleted 表示工作区里没有这个文件。 */
export function workingSectionBacking(
  input: WorkingSectionInput
): Extract<GitReviewPatchBacking, { kind: "derived" }> {
  const { staged, unstaged } = input.resolvedEntry.groupFacts;
  const worktreeSide = unstaged ?? staged;
  return {
    kind: "derived",
    worktreeSide:
      worktreeSide !== undefined && worktreeSide.status !== "deleted"
        ? "present"
        : "absent",
  };
}

export function workingStageState(
  input: WorkingSectionInput
): GitReviewStageState {
  const hasStaged = input.resolvedEntry.groupFacts.staged !== undefined;
  const hasUnstaged = input.resolvedEntry.groupFacts.unstaged !== undefined;
  if (hasStaged && hasUnstaged) {
    return "partial";
  }
  return hasStaged ? "staged" : "unstaged";
}

export function classifyWorkingChangeBlocks(
  workingSection: Extract<GitReviewFileSection, { kind: "patch" }>,
  existingSections: readonly GitReviewFileSection[]
): Extract<GitReviewFileSection, { kind: "patch" }> {
  const stagedBlocks = existingSections.flatMap((section) =>
    section.kind === "patch"
      ? section.changeBlocks.filter((block) => block.stageState === "staged")
      : []
  );
  const unstagedBlocks = existingSections.flatMap((section) =>
    section.kind === "patch"
      ? section.changeBlocks.filter((block) => block.stageState === "unstaged")
      : []
  );
  return {
    ...workingSection,
    changeBlocks: workingSection.changeBlocks.map((block) => {
      const staged = stagedBlocks.some((candidate) =>
        rangesOverlap(block.headRange, candidate.headRange)
      );
      const unstaged = unstagedBlocks.some((candidate) =>
        rangesOverlap(block.workingRange, candidate.workingRange)
      );
      let stageState: GitReviewStageState = "unstaged";
      if (staged && unstaged) {
        stageState = "partial";
      } else if (staged) {
        stageState = "staged";
      }
      return {
        ...block,
        stageState,
      };
    }),
  };
}

function rangesOverlap(
  left: GitReviewChangeBlock["headRange"],
  right: GitReviewChangeBlock["headRange"]
): boolean {
  const leftEnd = left.start + Math.max(left.count, 1);
  const rightEnd = right.start + Math.max(right.count, 1);
  return left.start < rightEnd && right.start < leftEnd;
}
