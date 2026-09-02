import type {
  GitReviewFileDocumentOk,
  GitReviewFileStatus,
  GitReviewIndexEntry,
  GitReviewStageState,
} from "@shared/contracts/git/review.ts";
import { parseChangeBlocksFromPatch } from "@shared/git-patch-hunk.ts";

export function patchDocument(options: {
  readonly entryKey: string;
  readonly newContents?: string;
  readonly oldContents?: string;
  readonly patch: string;
  readonly revision?: string;
  readonly sectionKey?: string;
  readonly stageState?: GitReviewStageState | null;
}): GitReviewFileDocumentOk {
  const sectionKey = options.sectionKey ?? `section:${options.entryKey}`;
  return {
    entryKey: options.entryKey,
    kind: "ok",
    revision: options.revision ?? `revision:${options.entryKey}`,
    sections: [
      patchSection(
        options.patch,
        sectionKey,
        options.stageState,
        options.oldContents,
        options.newContents
      ),
    ],
    surfaceSections: surfaceSectionsFor(
      sectionKey,
      options.stageState ?? "unstaged"
    ),
  };
}

function patchSection(
  patch: string,
  sectionKey: string,
  stageState: GitReviewStageState | null = "unstaged",
  oldContents?: string,
  newContents?: string
): GitReviewFileDocumentOk["sections"][number] {
  return {
    changeBlocks: parseChangeBlocksFromPatch(patch).map((block) => ({
      changeBlockIndex: block.changeBlockIndex,
      changeKey: `sha256:${"0".repeat(48)}${sectionKey.length.toString(16).padStart(8, "0")}${block.hunkIndex.toString(16).padStart(4, "0")}${block.changeBlockIndex.toString(16).padStart(4, "0")}`,
      headRange: {
        count: block.deletionCount,
        start: block.deletionStart,
      },
      hunkIndex: block.hunkIndex,
      stageState,
      workingRange: {
        count: block.additionCount,
        start: block.additionStart,
      },
    })),
    kind: "patch",
    patch,
    sectionKey,
    ...(oldContents === undefined || newContents === undefined
      ? {}
      : { newContents, oldContents }),
  };
}

export function stateDocument(options: {
  readonly entryKey: string;
  readonly oldPath?: string | null;
  readonly path: string;
  readonly reason?:
    | "binary"
    | "conflict"
    | "invalidEncoding"
    | "readError"
    | "submodule"
    | "symlink"
    | "tooLarge";
  readonly revision?: string;
  readonly sectionKey?: string;
  readonly status?: GitReviewFileStatus;
}): GitReviewFileDocumentOk {
  return {
    entryKey: options.entryKey,
    kind: "ok",
    revision: options.revision ?? `revision:${options.entryKey}:state`,
    sections: [
      {
        kind: "state",
        oldPath: options.oldPath ?? null,
        reason: options.reason ?? "binary",
        sectionKey: options.sectionKey ?? `section:${options.entryKey}`,
        status: options.status ?? "modified",
        targetPath: options.path,
      },
    ],
    surfaceSections: {
      committed: null,
      head: options.sectionKey ?? `section:${options.entryKey}`,
      index: null,
      staged: null,
    },
  };
}

export function patchDocumentForEntry(
  entry: GitReviewIndexEntry,
  content = "const value = 1;"
): GitReviewFileDocumentOk {
  const patch = [
    `diff --git a/${entry.path} b/${entry.path}`,
    `--- a/${entry.path}`,
    `+++ b/${entry.path}`,
    "@@ -1 +1 @@",
    `-${content}`,
    `+${content} changed`,
    "",
  ].join("\n");
  return {
    entryKey: entry.entryKey,
    kind: "ok",
    revision: `revision:${entry.entryKey}:${content.length}`,
    sections: entry.renderSlots.map((slot) =>
      patchSection(patch, slot.sectionKey, stageStateForGroup(slot.group))
    ),
    surfaceSections: {
      committed:
        entry.renderSlots.find((slot) => slot.group === "committed")
          ?.sectionKey ?? null,
      head:
        entry.renderSlots.find((slot) => slot.group === "conflict")
          ?.sectionKey ?? null,
      index:
        entry.renderSlots.find((slot) => slot.group === "unstaged")
          ?.sectionKey ?? null,
      staged:
        entry.renderSlots.find((slot) => slot.group === "staged")?.sectionKey ??
        null,
    },
  };
}

function surfaceSectionsFor(
  sectionKey: string,
  stageState: GitReviewStageState | null
): GitReviewFileDocumentOk["surfaceSections"] {
  return {
    committed: stageState === null ? sectionKey : null,
    head: stageState === "partial" ? sectionKey : null,
    index: stageState === "unstaged" ? sectionKey : null,
    staged: stageState === "staged" ? sectionKey : null,
  };
}

function stageStateForGroup(
  group: GitReviewIndexEntry["renderSlots"][number]["group"]
): GitReviewStageState | null {
  if (group === "staged") {
    return "staged";
  }
  if (group === "unstaged") {
    return "unstaged";
  }
  return null;
}
