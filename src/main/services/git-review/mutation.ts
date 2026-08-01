import {
  type GitReviewFailure,
  type GitReviewFileSection,
  type GitReviewGroup,
  type GitReviewIndexEntry,
  type GitReviewMutationRequest,
  type GitReviewMutationResult,
  type GitReviewScope,
  gitReviewFailureSchema,
  gitReviewMutationOkSchema,
} from "../../../shared/contracts/git/review.ts";
import type { GitApplyPatchResult } from "../../../shared/contracts/git.ts";
import {
  extractChangeBlockPatch,
  extractChangeBlocksPatch,
} from "../../../shared/git-patch-hunk.ts";
import type { GitApplyPatchRequest } from "../git/apply-patch.ts";
import type { GitReviewDocumentReader } from "./document/reader.ts";
import type { GitReviewIndexGroupFact } from "./index/contract.ts";
import type { GitReviewIndexReader } from "./index/index.ts";
import type { GitReviewExecutionBudget } from "./scheduler/index.ts";

export interface GitReviewMutationWriter {
  applyPatch(
    cwd: string,
    request: GitApplyPatchRequest
  ): Promise<GitApplyPatchResult>;
  discardChanges(
    cwd: string,
    request: { readonly paths: string[] }
  ): Promise<void>;
  stage(cwd: string, request: { readonly paths: string[] }): Promise<void>;
  unstage(cwd: string, request: { readonly paths: string[] }): Promise<void>;
}

type MutationIndexReader = Pick<GitReviewIndexReader, "read" | "resolve">;
type MutationFailure = Extract<GitReviewMutationResult, { kind: "error" }>;
type MutationGroup = GitReviewGroup | "working";

/** Resolve a semantic file/change target and write it. Authoritative UI state is published separately. */
export async function applyGitReviewMutation(options: {
  readonly budget: GitReviewExecutionBudget;
  readonly documentReader: GitReviewDocumentReader;
  readonly indexReader: MutationIndexReader;
  readonly request: GitReviewMutationRequest;
  readonly signal: AbortSignal;
  readonly writer: GitReviewMutationWriter;
}): Promise<GitReviewMutationResult> {
  const { budget, documentReader, indexReader, request, signal, writer } =
    options;
  const current = await documentReader.execute(request, budget, signal);
  if (current.kind === "error") {
    return current;
  }
  if (current.kind === "unchanged") {
    return failure(
      "changeNotFound",
      true,
      "The selected change no longer exists"
    );
  }
  if (current.revision !== request.expectedRevision) {
    return failure(
      "staleRevision",
      true,
      "The file changed before the operation ran"
    );
  }
  const section = current.sections.find(
    (candidate) => candidate.sectionKey === request.target.sectionKey
  );
  if (section === undefined) {
    return failure(
      "changeNotFound",
      true,
      "The selected Git section no longer exists"
    );
  }
  if (request.target.kind === "change" && section.kind !== "patch") {
    return failure(
      "changeNotFound",
      false,
      "This file has no editable text change"
    );
  }
  if (request.target.kind === "change") {
    const evidence = documentReader.getEvidence(current.revision);
    if (
      evidence === null ||
      !evidence.patches.some(
        (candidate) => candidate.sectionKey === section.sectionKey
      )
    ) {
      return failure(
        "internal",
        true,
        "Git Review mutation evidence is unavailable"
      );
    }
  }
  const entryResolution = await indexReader.resolve(
    {
      paths: [request.source.path, ...request.source.oldPaths],
      scope: mutationScope(request),
    },
    { budget, signal }
  );
  if (entryResolution.kind !== "ok") {
    return entryResolution;
  }
  const entryIndex = entryResolution.result.entries.findIndex(
    (candidate) => candidate.entryKey === current.entryKey
  );
  const entry = entryResolution.result.entries[entryIndex];
  const resolvedEntry = entryResolution.resolvedEntries[entryIndex];
  if (
    entry === undefined ||
    resolvedEntry === undefined ||
    entry.path !== resolvedEntry.path
  ) {
    return failure(
      "changeNotFound",
      true,
      "The selected file no longer exists"
    );
  }
  const slot = entry.renderSlots.find(
    (candidate) => candidate.sectionKey === section.sectionKey
  );
  const group: MutationGroup | null =
    slot?.group ??
    (current.surfaceSections.head === section.sectionKey ? "working" : null);
  if (group === null) {
    return failure(
      "changeNotFound",
      true,
      "The selected Git section no longer exists"
    );
  }

  let mutationFailure: MutationFailure | null;
  if (request.target.kind === "file") {
    const groupFact =
      slot === undefined ? undefined : resolvedEntry.groupFacts[slot.group];
    const paths = fileMutationPaths(slot, section, groupFact);
    if (paths === null) {
      return failure(
        "changeNotFound",
        true,
        "The selected file path can no longer be resolved"
      );
    }
    mutationFailure = await mutateReviewFile({
      action: request.action,
      cwd: request.source.gitRootPath,
      group,
      paths,
      writer,
    });
  } else {
    if (section.kind !== "patch") {
      return failure(
        "changeNotFound",
        false,
        "This file has no editable text change"
      );
    }
    mutationFailure = await mutateReviewChange({
      action: request.action,
      changeKey: request.target.changeKey,
      cwd: request.source.gitRootPath,
      group,
      sections: current.sections,
      section,
      writer,
    });
  }
  if (mutationFailure !== null) {
    return mutationFailure;
  }

  return gitReviewMutationOkSchema.parse({
    kind: "ok",
    operationId: request.operationId,
  });
}

function mutationScope(request: GitReviewMutationRequest): GitReviewScope {
  return {
    contextId: request.source.contextId,
    gitRootPath: request.source.gitRootPath,
    target: request.source.target,
  };
}

async function mutateReviewFile(options: {
  readonly action: GitReviewMutationRequest["action"];
  readonly cwd: string;
  readonly group: MutationGroup;
  readonly paths: readonly string[];
  readonly writer: GitReviewMutationWriter;
}): Promise<MutationFailure | null> {
  if (options.action === "stage") {
    if (options.group === "working") {
      await options.writer.stage(options.cwd, { paths: [...options.paths] });
      return null;
    }
    if (options.group !== "unstaged") {
      return failure("staleRevision", true, "This section is not unstaged");
    }
    await options.writer.stage(options.cwd, { paths: [...options.paths] });
    return null;
  }
  if (options.action === "unstage") {
    if (options.group === "working") {
      await options.writer.unstage(options.cwd, {
        paths: [...options.paths],
      });
      return null;
    }
    if (options.group !== "staged") {
      return failure("staleRevision", true, "This section is not staged");
    }
    await options.writer.unstage(options.cwd, { paths: [...options.paths] });
    return null;
  }
  if (options.group !== "unstaged" && options.group !== "working") {
    return failure(
      "changeNotFound",
      false,
      "Only unstaged changes can be restored"
    );
  }
  await options.writer.discardChanges(options.cwd, {
    paths: [...options.paths],
  });
  return null;
}

function fileMutationPaths(
  slot: GitReviewIndexEntry["renderSlots"][number] | undefined,
  section: GitReviewFileSection,
  groupFact: GitReviewIndexGroupFact | undefined
): readonly string[] | null {
  if (slot !== undefined) {
    if (
      groupFact === undefined ||
      groupFact.targetPath !== slot.targetPath ||
      groupFact.oldPath !== slot.oldPath
    ) {
      return null;
    }
    if (groupFact.movement === "rename") {
      return groupFact.oldPath === null
        ? null
        : uniquePaths(groupFact.targetPath, groupFact.oldPath);
    }
    if (groupFact.movement === "copy") {
      return [groupFact.targetPath];
    }
    return groupFact.oldPath === null ? [groupFact.targetPath] : null;
  }
  if (section.kind === "state") {
    return section.oldPath === null ? [section.targetPath] : null;
  }
  return null;
}

function uniquePaths(
  targetPath: string,
  oldPath: string | null
): readonly string[] {
  return oldPath === null || oldPath === targetPath
    ? [targetPath]
    : [targetPath, oldPath];
}

async function mutateReviewChange(options: {
  readonly action: GitReviewMutationRequest["action"];
  readonly changeKey: string;
  readonly cwd: string;
  readonly group: MutationGroup;
  readonly section: Extract<GitReviewFileSection, { kind: "patch" }>;
  readonly sections: readonly GitReviewFileSection[];
  readonly writer: GitReviewMutationWriter;
}): Promise<MutationFailure | null> {
  const change = options.section.changeBlocks.find(
    (candidate) => candidate.changeKey === options.changeKey
  );
  if (change === undefined || change.stageState === null) {
    return failure(
      "changeNotFound",
      true,
      "The selected change no longer exists"
    );
  }
  if (
    options.action === "revert" &&
    options.group === "working" &&
    change.stageState !== "unstaged"
  ) {
    return failure(
      "staleRevision",
      true,
      "Only an unstaged Head change can be restored"
    );
  }
  const primaryPatch = extractChangeBlockPatch(
    options.section.patch,
    change.hunkIndex,
    change.changeBlockIndex
  );
  if (options.action === "stage") {
    if (options.group === "working") {
      return mutateWorkingChange(options, change, "stage");
    }
    if (options.group !== "unstaged") {
      return failure(
        "staleRevision",
        true,
        "The selected change is already staged"
      );
    }
    return applyMutationPatch(options.writer, options.cwd, {
      atomic: true,
      diff: primaryPatch,
      target: "staged",
    });
  }
  if (options.action === "unstage") {
    if (options.group === "working") {
      return mutateWorkingChange(options, change, "unstage");
    }
    if (options.group !== "staged") {
      return failure(
        "staleRevision",
        true,
        "Only a fully staged change can be unstaged"
      );
    }
    return applyMutationPatch(options.writer, options.cwd, {
      atomic: true,
      diff: primaryPatch,
      revert: true,
      target: "staged",
    });
  }
  if (options.group === "unstaged" || options.group === "working") {
    return applyMutationPatch(options.writer, options.cwd, {
      atomic: true,
      diff: primaryPatch,
      revert: true,
      target: "unstaged",
    });
  }
  return failure(
    "changeNotFound",
    false,
    "Only unstaged changes can be restored"
  );
}

async function mutateWorkingChange(
  options: {
    readonly cwd: string;
    readonly section: Extract<GitReviewFileSection, { kind: "patch" }>;
    readonly sections: readonly GitReviewFileSection[];
    readonly writer: GitReviewMutationWriter;
  },
  workingChange: Extract<
    GitReviewFileSection,
    { kind: "patch" }
  >["changeBlocks"][number],
  action: "stage" | "unstage"
): Promise<MutationFailure | null> {
  const desiredState = action === "stage" ? "unstaged" : "staged";
  const candidates = options.sections.flatMap((section) => {
    if (section.kind !== "patch" || section === options.section) {
      return [];
    }
    return section.changeBlocks.flatMap((block) =>
      block.stageState === desiredState &&
      workingChangeOverlaps(workingChange, block, desiredState)
        ? [{ block, section }]
        : []
    );
  });
  if (candidates.length === 0) {
    return failure(
      "changeNotFound",
      true,
      "The selected change no longer has a matching Git side"
    );
  }
  const candidateSection = candidates[0]?.section;
  if (
    candidateSection === undefined ||
    candidates.some(
      (candidate) =>
        candidate.section.sectionKey !== candidateSection.sectionKey
    )
  ) {
    return failure(
      "internal",
      true,
      "The selected change resolved to multiple Git sections"
    );
  }
  const patch = extractChangeBlocksPatch(
    candidateSection.patch,
    candidates.map((candidate) => ({
      changeBlockIndex: candidate.block.changeBlockIndex,
      hunkIndex: candidate.block.hunkIndex,
    }))
  );
  return applyMutationPatch(options.writer, options.cwd, {
    atomic: true,
    diff: patch,
    ...(action === "unstage" ? { revert: true } : {}),
    target: "staged",
  });
}

function workingChangeOverlaps(
  working: Extract<
    GitReviewFileSection,
    { kind: "patch" }
  >["changeBlocks"][number],
  candidate: Extract<
    GitReviewFileSection,
    { kind: "patch" }
  >["changeBlocks"][number],
  side: "staged" | "unstaged"
): boolean {
  return side === "staged"
    ? rangesOverlap(working.headRange, candidate.headRange)
    : rangesOverlap(working.workingRange, candidate.workingRange);
}

function rangesOverlap(
  left: { readonly count: number; readonly start: number },
  right: { readonly count: number; readonly start: number }
): boolean {
  const leftEnd = left.start + Math.max(left.count, 1);
  const rightEnd = right.start + Math.max(right.count, 1);
  return left.start < rightEnd && right.start < leftEnd;
}

async function applyMutationPatch(
  writer: GitReviewMutationWriter,
  cwd: string,
  request: GitApplyPatchRequest
): Promise<MutationFailure | null> {
  const result = await writer.applyPatch(cwd, request);
  return result.status === "success"
    ? null
    : failure("commandFailed", false, result.message ?? "git apply failed");
}

function failure(
  reason: GitReviewFailure["reason"],
  retryable: boolean,
  message: string | null
): GitReviewFailure {
  return gitReviewFailureSchema.parse({
    kind: "error",
    message,
    reason,
    retryable,
  });
}
