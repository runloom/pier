import { createHash } from "node:crypto";
import {
  GIT_REVIEW_GROUP_ORDER,
  type GitReviewFileDocumentOk,
  type GitReviewFileSection,
  type GitReviewFileSource,
  type GitReviewGroup,
  gitReviewFileDocumentOkSchema,
} from "../../../shared/contracts/git-review.ts";
import type { ExecGitRaw } from "../git-exec.ts";
import {
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type GitReviewRenderableGroup,
  readGitReviewPatch,
} from "./git-review-document-patch.ts";
import type { GitReviewIndexMetadata } from "./git-review-index.ts";
import type { GitReviewIndexResolvedEntry } from "./git-review-index-assembler.ts";
import type { GitReviewIndexExecutionBudget } from "./git-review-index-contract.ts";
import { createGitReviewSectionKey } from "./git-review-section-key.ts";

interface BuildGitReviewDocumentOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly execGitRaw: ExecGitRaw;
  readonly metadata: GitReviewIndexMetadata;
  readonly resolvedEntry: GitReviewIndexResolvedEntry;
  readonly signal?: AbortSignal;
  readonly source: GitReviewFileSource;
}

export async function buildGitReviewDocument(
  options: BuildGitReviewDocumentOptions
): Promise<GitReviewFileDocumentOk> {
  const sections: GitReviewFileSection[] = [];
  const sectionRevisions: string[] = [];
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    const fact = options.resolvedEntry.groupFacts[group];
    if (fact === undefined) {
      continue;
    }
    if (group === "conflict") {
      const sourceRevision = hashParts([
        "pier.git-review.conflict.v1",
        options.metadata.indexRevision,
        options.source.path,
      ]);
      const key = createGitReviewSectionKey(group, null, fact.targetPath);
      sections.push({
        kind: "state",
        oldPath: fact.oldPath,
        reason: "conflict",
        sectionKey: key,
        status: fact.status,
        targetPath: fact.targetPath,
      });
      sectionRevisions.push(sourceRevision);
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
    const section = sectionFromMaterial(group, fact, material);
    sections.push(section);
    sectionRevisions.push(material.sourceRevision);
  }
  const revision = createGitReviewDocumentRevision(
    options.metadata.indexRevision,
    options.source,
    sections,
    sectionRevisions
  );
  return deepFreezeJson(
    gitReviewFileDocumentOkSchema.parse({
      kind: "ok",
      revision,
      sections,
    })
  );
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

function createGitReviewDocumentRevision(
  indexRevision: string,
  source: GitReviewFileSource,
  sections: readonly GitReviewFileSection[],
  sectionRevisions: readonly string[]
): string {
  return hashParts([
    "pier.git-review.document.v1",
    indexRevision,
    JSON.stringify(source),
    ...sections.flatMap((section, index) => [
      section.sectionKey,
      sectionRevisions[index] ?? "",
    ]),
  ]);
}

function sectionFromMaterial(
  group: GitReviewRenderableGroup,
  fact: RenderableGitReviewIndexFact,
  material: GitReviewPatchMaterial
): GitReviewFileSection {
  const sectionKey = createGitReviewSectionKey(
    group,
    fact.oldPath,
    fact.targetPath
  );
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
  return {
    kind: "patch",
    patch: material.patch,
    sectionKey,
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

function isRenderableGroup(
  group: GitReviewGroup
): group is GitReviewRenderableGroup {
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
