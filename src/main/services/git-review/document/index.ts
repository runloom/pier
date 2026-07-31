import { createHash } from "node:crypto";
import {
  GIT_REVIEW_GROUP_ORDER,
  type GitReviewChangeBlock,
  type GitReviewFileDocumentOk,
  type GitReviewFileSection,
  type GitReviewFileSource,
  type GitReviewGroup,
  type GitReviewIndexEntry,
  type GitReviewStageState,
  gitReviewFileDocumentOkSchema,
} from "../../../../shared/contracts/git/review.ts";
import {
  type IndexedUnifiedChangeBlock,
  parseChangeBlocksFromPatch,
} from "../../../../shared/git-patch-hunk.ts";
import type { ExecGitRaw } from "../../git/exec.ts";
import type { GitReviewIndexResolvedEntry } from "../index/assembler.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "../index/contract.ts";
import type { GitReviewIndexMetadata } from "../index/index.ts";
import { createGitReviewSectionKey } from "../section-key.ts";
import {
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type GitReviewRenderableGroup,
  readGitReviewPatch,
} from "./patch.ts";

interface BuildGitReviewDocumentOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly entry: GitReviewIndexEntry;
  readonly execGitRaw: ExecGitRaw;
  readonly metadata: GitReviewIndexMetadata;
  readonly resolvedEntry: GitReviewIndexResolvedEntry;
  readonly signal?: AbortSignal;
  readonly source: GitReviewFileSource;
}

export interface GitReviewDocumentEvidencePatch {
  readonly group: GitReviewRenderableGroup;
  readonly patch: string;
  readonly sectionKey: string;
}

export interface GitReviewDocumentEvidence {
  readonly patches: readonly GitReviewDocumentEvidencePatch[];
}

export interface GitReviewDocumentBuildResult {
  readonly document: GitReviewFileDocumentOk;
  readonly evidence: GitReviewDocumentEvidence;
}

export async function buildGitReviewDocument(
  options: BuildGitReviewDocumentOptions
): Promise<GitReviewFileDocumentOk> {
  return (await buildGitReviewDocumentWithEvidence(options)).document;
}

/** Build independent HEAD→Index and Index→Working Tree sections. */
export async function buildGitReviewDocumentWithEvidence(
  options: BuildGitReviewDocumentOptions
): Promise<GitReviewDocumentBuildResult> {
  const sections: GitReviewFileSection[] = [];
  const revisions: string[] = [];
  const patches: GitReviewDocumentEvidencePatch[] = [];
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    const fact = options.resolvedEntry.groupFacts[group];
    if (fact === undefined) {
      continue;
    }
    const sectionKey = createGitReviewSectionKey(
      group,
      fact.oldPath,
      fact.targetPath
    );
    if (group === "conflict") {
      sections.push({
        kind: "state",
        oldPath: null,
        reason: "conflict",
        sectionKey,
        status: "conflicted",
        targetPath: fact.targetPath,
      });
      revisions.push(options.metadata.indexRevision);
      continue;
    }
    if (!(isRenderableGroup(group) && isRenderableFact(fact))) {
      throw new Error(`Git Review section group ${group} 不可渲染`);
    }
    const material = await readGitReviewPatch({
      budget: options.budget,
      execGitRaw: options.execGitRaw,
      fact,
      gitRootPath: options.metadata.canonicalRoot,
      group,
      headOid: options.metadata.headOid,
      rangeBounds: options.metadata.rangeBounds,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    assertMaterialMatchesIndexFact(group, fact, material);
    const section = sectionFromMaterial({
      entryKey: options.entry.entryKey,
      fact,
      group,
      material,
      sectionKey,
    });
    sections.push(section);
    revisions.push(material.sourceRevision);
    if (section.kind === "patch") {
      patches.push({ group, patch: section.patch, sectionKey });
    }
  }
  const workingFact = createWorkingFact(options);
  if (workingFact !== null) {
    const group = "working" as const;
    const sectionKey = createGitReviewSectionKey(
      group,
      workingFact.oldPath,
      workingFact.targetPath
    );
    const material = await readGitReviewPatch({
      budget: options.budget,
      execGitRaw: options.execGitRaw,
      fact: workingFact,
      gitRootPath: options.metadata.canonicalRoot,
      group,
      headOid: options.metadata.headOid,
      rangeBounds: options.metadata.rangeBounds,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    assertMaterialMatchesIndexFact(group, workingFact, material);
    const rawSection = sectionFromMaterial({
      entryKey: options.entry.entryKey,
      fact: workingFact,
      group,
      material,
      sectionKey,
      stageStateOverride: workingStageState(options),
    });
    const section =
      rawSection.kind === "patch"
        ? classifyWorkingChangeBlocks(rawSection, sections)
        : rawSection;
    sections.push(section);
    revisions.push(material.sourceRevision);
    if (section.kind === "patch") {
      patches.push({ group, patch: section.patch, sectionKey });
    }
  }
  const surfaceSections = resolveSurfaceSections(options, sections);
  const document = deepFreezeJson(
    gitReviewFileDocumentOkSchema.parse({
      entryKey: options.entry.entryKey,
      kind: "ok",
      revision: createDocumentRevision(options, sections, revisions),
      sections,
      surfaceSections,
    })
  );
  return deepFreezeJson({ document, evidence: { patches } });
}

function classifyWorkingChangeBlocks(
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

function sectionFromMaterial(options: {
  readonly entryKey: string;
  readonly fact: RenderableGitReviewIndexFact;
  readonly group: GitReviewRenderableGroup;
  readonly material: GitReviewPatchMaterial;
  readonly sectionKey: string;
  readonly stageStateOverride?: GitReviewStageState | null;
}): GitReviewFileSection {
  const { entryKey, fact, group, material, sectionKey } = options;
  if (material.kind === "state") {
    return {
      kind: "state",
      oldPath: fact.oldPath,
      reason: material.reason,
      sectionKey,
      status: fact.status,
      targetPath: fact.targetPath,
    };
  }
  const stageState =
    options.stageStateOverride === undefined
      ? stageStateForGroup(group)
      : options.stageStateOverride;
  return {
    changeBlocks: parseChangeBlocksFromPatch(material.patch).map((block) =>
      describeChangeBlock({ block, entryKey, sectionKey, stageState })
    ),
    kind: "patch",
    patch: material.patch,
    sectionKey,
  };
}

function workingStageState(
  options: BuildGitReviewDocumentOptions
): GitReviewStageState {
  const hasStaged = options.resolvedEntry.groupFacts.staged !== undefined;
  const hasUnstaged = options.resolvedEntry.groupFacts.unstaged !== undefined;
  if (hasStaged && hasUnstaged) {
    return "partial";
  }
  return hasStaged ? "staged" : "unstaged";
}

function describeChangeBlock(options: {
  readonly block: IndexedUnifiedChangeBlock;
  readonly entryKey: string;
  readonly sectionKey: string;
  readonly stageState: GitReviewStageState | null;
}): GitReviewChangeBlock {
  const { block, entryKey, sectionKey, stageState } = options;
  return {
    changeBlockIndex: block.changeBlockIndex,
    changeKey: createChangeKey(entryKey, sectionKey, block),
    headRange: { count: block.deletionCount, start: block.deletionStart },
    hunkIndex: block.hunkIndex,
    stageState,
    workingRange: { count: block.additionCount, start: block.additionStart },
  };
}

function stageStateForGroup(
  group: GitReviewRenderableGroup
): GitReviewStageState | null {
  if (group === "staged") {
    return "staged";
  }
  if (group === "unstaged") {
    return "unstaged";
  }
  if (group === "working") {
    return "partial";
  }
  return null;
}

function createChangeKey(
  entryKey: string,
  sectionKey: string,
  block: IndexedUnifiedChangeBlock
): string {
  return `sha256:${createHash("sha256")
    .update("pier.git-review.section-change.v1\0", "utf8")
    .update(entryKey, "utf8")
    .update("\0", "utf8")
    .update(sectionKey, "utf8")
    .update("\0", "utf8")
    .update(
      JSON.stringify([block.hunkIndex, block.changeBlockIndex, block.lines])
    )
    .digest("hex")}`;
}

function assertMaterialMatchesIndexFact(
  group: GitReviewRenderableGroup,
  fact: RenderableGitReviewIndexFact,
  material: GitReviewPatchMaterial
): void {
  if (
    (fact.sourceOid !== null &&
      (material.sourceOid !== null || group === "staged") &&
      material.sourceOid !== fact.sourceOid) ||
    (fact.targetOid !== null &&
      (material.targetOid !== null || group === "staged") &&
      material.targetOid !== fact.targetOid)
  ) {
    throw new GitReviewDocumentStaleError(
      "Git Review patch 对象与 index 事实不一致"
    );
  }
}

function createWorkingFact(
  options: BuildGitReviewDocumentOptions
): RenderableGitReviewIndexFact | null {
  if (options.source.target.kind !== "uncommitted") {
    return null;
  }
  const staged = options.resolvedEntry.groupFacts.staged;
  const unstaged = options.resolvedEntry.groupFacts.unstaged;
  if (staged === undefined && unstaged === undefined) {
    return null;
  }
  if (options.entry.status === "conflicted") {
    return null;
  }
  const status: Exclude<GitReviewIndexGroupFact["status"], "conflicted"> =
    options.entry.status;
  const first = staged ?? unstaged;
  if (first === undefined) {
    return null;
  }
  return {
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

function resolveSurfaceSections(
  options: BuildGitReviewDocumentOptions,
  sections: readonly GitReviewFileSection[]
): GitReviewFileDocumentOk["surfaceSections"] {
  const existing = new Set(sections.map((section) => section.sectionKey));
  const sectionFor = (group: GitReviewGroup | "working"): string | null => {
    const fact =
      group === "working"
        ? createWorkingFact(options)
        : options.resolvedEntry.groupFacts[group];
    if (fact === undefined || fact === null) {
      return null;
    }
    const sectionKey = createGitReviewSectionKey(
      group,
      group === "conflict" ? null : fact.oldPath,
      fact.targetPath
    );
    return existing.has(sectionKey) ? sectionKey : null;
  };
  return {
    committed: sectionFor("committed"),
    head: sectionFor("conflict") ?? sectionFor("working"),
    index: sectionFor("unstaged"),
    staged: sectionFor("staged"),
  };
}

function createDocumentRevision(
  options: BuildGitReviewDocumentOptions,
  sections: readonly GitReviewFileSection[],
  revisions: readonly string[]
): string {
  return hashParts([
    "pier.git-review.document.v3",
    options.entry.entryKey,
    JSON.stringify(options.source.target),
    ...sections.flatMap((section, index) => [
      section.sectionKey,
      revisions[index] ?? "",
    ]),
  ]);
}

type GitReviewIndexFact = NonNullable<
  GitReviewIndexResolvedEntry["groupFacts"][GitReviewGroup]
>;
type RenderableGitReviewIndexFact = GitReviewIndexFact & {
  readonly status: Exclude<GitReviewIndexFact["status"], "conflicted">;
};

function isRenderableFact(
  fact: GitReviewIndexFact
): fact is RenderableGitReviewIndexFact {
  return fact.status !== "conflicted";
}

function isRenderableGroup(
  group: GitReviewGroup
): group is Exclude<GitReviewRenderableGroup, "working"> {
  return group === "unstaged" || group === "staged" || group === "committed";
}

function hashParts(parts: readonly string[]): string {
  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(part, "utf8");
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}

function deepFreezeJson<T>(value: T): T {
  const seen = new WeakSet<object>();
  const work: unknown[] = [value];
  while (work.length > 0) {
    const current = work.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      work.push(...current);
    } else {
      work.push(...Object.values(current));
    }
    Object.freeze(current);
  }
  return value;
}
