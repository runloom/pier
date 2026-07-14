import { createHash } from "node:crypto";
import {
  GIT_REVIEW_GROUP_ORDER,
  type GitDiffPanelSource,
  type GitReviewFileDocumentOk,
  type GitReviewFileSection,
  type GitReviewGroup,
  type GitReviewIndexEntry,
  type GitReviewIndexOk,
  gitReviewFileDocumentOkSchema,
} from "../../../shared/contracts/git-review.ts";
import type { ExecGitRaw } from "../git-exec.ts";
import {
  GIT_REVIEW_DEFAULT_CONTEXT_LINES,
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type GitReviewRenderableGroup,
  readGitReviewPatch,
} from "./git-review-document-patch.ts";
import type { GitReviewIndexResolvedEntry } from "./git-review-index-assembler.ts";
import type { GitReviewIndexExecutionBudget } from "./git-review-index-contract.ts";

export interface BuildGitReviewDocumentOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly entry: GitReviewIndexEntry;
  readonly execGitRaw: ExecGitRaw;
  readonly index: GitReviewIndexOk;
  readonly now?: () => number;
  readonly resolvedEntry: GitReviewIndexResolvedEntry;
  readonly signal?: AbortSignal;
  readonly source: GitDiffPanelSource;
  readonly startedAt: number;
}

export async function buildGitReviewDocument(
  options: BuildGitReviewDocumentOptions
): Promise<GitReviewFileDocumentOk> {
  const sections: GitReviewFileSection[] = [];
  let stagedIndexOid: string | null = null;
  let unstagedIndexOid: string | null = null;
  for (const group of orderedEntryGroups(options.entry.groups)) {
    const fact = options.resolvedEntry.groupFacts[group];
    if (fact === undefined) {
      throw new Error(`Git Review resolved entry 缺少 ${group} fact`);
    }
    if (group === "conflict") {
      const sourceRevision = hashParts([
        "pier.git-review.conflict.v1",
        options.index.revision,
        options.source.path,
      ]);
      sections.push({
        additions: null,
        byteSize: null,
        deletions: null,
        group,
        kind: "state",
        lineCount: null,
        message: null,
        oldPath: null,
        path: fact.targetPath,
        reason: "conflict",
        sectionKey: sectionKey(group, null, fact.targetPath),
        sourceRevision,
        status: "conflicted",
      });
      continue;
    }
    if (!(isRenderableGroup(group) && isRenderableFact(fact))) {
      throw new Error(`Git Review section group ${group} 不可渲染`);
    }
    const material = await readGitReviewPatch({
      budget: options.budget,
      execGitRaw: options.execGitRaw,
      fact,
      gitRootPath: options.index.gitRootPath,
      group,
      query: options.index.query,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (group === "staged") {
      stagedIndexOid = material.targetOid;
    } else if (group === "unstaged") {
      unstagedIndexOid = material.sourceOid;
    }
    sections.push(sectionFromMaterial(group, fact, material));
  }
  if (
    stagedIndexOid !== null &&
    unstagedIndexOid !== null &&
    stagedIndexOid !== unstagedIndexOid
  ) {
    throw new GitReviewDocumentStaleError(
      "Git Review staged/unstaged section 的 index blob 不一致"
    );
  }
  const revision = hashParts([
    "pier.git-review.document.v1",
    options.index.revision,
    JSON.stringify(options.source),
    ...sections.flatMap((section) => [
      section.sectionKey,
      section.sourceRevision,
    ]),
  ]);
  return gitReviewFileDocumentOkSchema.parse({
    durationMs: Math.max(0, (options.now ?? Date.now)() - options.startedAt),
    kind: "ok",
    resolvedQuery: options.index.query,
    revision,
    sections,
    source: options.source,
  });
}

function sectionFromMaterial(
  group: GitReviewRenderableGroup,
  fact: RenderableGitReviewIndexFact,
  material: GitReviewPatchMaterial
): GitReviewFileSection {
  const base = {
    group,
    oldPath: fact.oldPath,
    path: fact.targetPath,
    sectionKey: sectionKey(group, fact.oldPath, fact.targetPath),
    sourceRevision: material.sourceRevision,
    status: fact.status,
  } as const;
  if (material.kind === "state") {
    return {
      ...base,
      additions: null,
      byteSize: material.byteSize,
      deletions: null,
      kind: "state",
      lineCount: material.lineCount,
      message: material.message,
      reason: material.reason,
    };
  }
  return {
    ...base,
    additions: material.additions,
    byteSize: material.byteSize,
    contextLines: GIT_REVIEW_DEFAULT_CONTEXT_LINES,
    deletions: material.deletions,
    kind: "patch",
    lineCount: material.lineCount,
    patch: material.patch,
  };
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

function orderedEntryGroups(
  groups: readonly GitReviewGroup[]
): GitReviewGroup[] {
  const selected = new Set(groups);
  return GIT_REVIEW_GROUP_ORDER.filter((group) => selected.has(group));
}

function isRenderableGroup(
  group: GitReviewGroup
): group is GitReviewRenderableGroup {
  return (
    group === "unstaged" ||
    group === "staged" ||
    group === "commit" ||
    group === "branch"
  );
}

function sectionKey(
  group: GitReviewGroup,
  oldPath: string | null,
  targetPath: string
): string {
  return hashParts([
    "pier.git-review.section-key.v1",
    group,
    oldPath ?? "",
    targetPath,
  ]);
}

function hashParts(parts: readonly string[]): string {
  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(part, "utf8");
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}
