import { z } from "zod";
import {
  GIT_REVIEW_GROUP_ORDER,
  GIT_REVIEW_STATUS_PRIORITY,
  gitObjectIdSchema,
  gitReviewCountSchema,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewGroupSchema,
  gitReviewRelativePathSchema,
  gitReviewRevisionSchema,
  gitReviewRootPathSchema,
  gitReviewWarningSchema,
  gitRevisionInputSchema,
} from "./primitives.ts";

const uncommittedGroupsSchema = z.union([
  z.tuple([z.literal("unstaged")]),
  z.tuple([z.literal("staged")]),
  z.tuple([z.literal("unstaged"), z.literal("staged")]),
]);

function isCompleteBranchRef(value: string): boolean {
  if (!/^refs\/(?:heads|remotes)\/(?!-)/u.test(value)) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      "~^:?*[\\".includes(character)
    ) {
      return false;
    }
  }
  if (
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock")
  ) {
    return false;
  }

  const [refs, namespace, ...components] = value.split("/");
  if (
    refs !== "refs" ||
    (namespace !== "heads" && namespace !== "remotes") ||
    components.length < (namespace === "remotes" ? 2 : 1)
  ) {
    return false;
  }
  return components.every(
    (component) =>
      component.length > 0 &&
      !component.startsWith(".") &&
      !component.endsWith(".") &&
      !component.endsWith(".lock")
  );
}

const targetRefSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isCompleteBranchRef, "Expected a complete branch ref");

export const gitReviewQuerySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    groups: uncommittedGroupsSchema,
    kind: z.literal("uncommitted"),
  }),
  z.strictObject({ kind: z.literal("commit"), oid: gitRevisionInputSchema }),
  z.strictObject({ kind: z.literal("branch"), targetRef: targetRefSchema }),
]);
export type GitReviewQuery = z.infer<typeof gitReviewQuerySchema>;

export const gitReviewPanelQuerySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    groups: uncommittedGroupsSchema,
    kind: z.literal("uncommitted"),
  }),
  z.strictObject({ kind: z.literal("commit"), oid: gitObjectIdSchema }),
  z.strictObject({ kind: z.literal("branch"), targetRef: targetRefSchema }),
]);
export type GitReviewPanelQuery = z.infer<typeof gitReviewPanelQuerySchema>;

export const gitReviewResolvedQuerySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    groups: uncommittedGroupsSchema,
    headOid: gitObjectIdSchema.nullable(),
    indexToken: z.string().min(1).max(256),
    kind: z.literal("uncommitted"),
  }),
  z.strictObject({
    baseOid: gitObjectIdSchema.nullable(),
    commitOid: gitObjectIdSchema,
    kind: z.literal("commit"),
    root: z.boolean(),
  }),
  z.strictObject({
    headOid: gitObjectIdSchema,
    kind: z.literal("branch"),
    mergeBaseOid: gitObjectIdSchema,
    targetOid: gitObjectIdSchema,
    targetRef: targetRefSchema,
  }),
]);
export type GitReviewResolvedQuery = z.infer<
  typeof gitReviewResolvedQuerySchema
>;

export const gitReviewScopeSchema = z.strictObject({
  contextId: z.string().min(1).max(256),
  gitRootPath: gitReviewRootPathSchema,
});
export type GitReviewScope = z.infer<typeof gitReviewScopeSchema>;

export const gitDiffPanelSourceSchema = gitReviewScopeSchema.extend({
  path: gitReviewRelativePathSchema,
  query: gitReviewPanelQuerySchema,
});
export type GitDiffPanelSource = z.infer<typeof gitDiffPanelSourceSchema>;

export type GitDiffPanelSourceIdentityTuple = readonly [
  contextId: string,
  gitRootPath: string,
  query:
    | readonly ["uncommitted", readonly ("unstaged" | "staged")[]]
    | readonly ["commit", string]
    | readonly ["branch", string],
  path: string,
];

/**
 * 序列化已规范化的 source 值；gitRootPath 的 realpath/case canonicalization
 * 仍由 T2 main identity 所有者在调用前完成，renderer 不得把词法路径当授权身份。
 */
export function getGitDiffPanelSourceIdentityTuple(
  input: GitDiffPanelSource
): GitDiffPanelSourceIdentityTuple {
  const source = gitDiffPanelSourceSchema.parse(input);
  let query: GitDiffPanelSourceIdentityTuple[2];
  if (source.query.kind === "uncommitted") {
    query = ["uncommitted", source.query.groups];
  } else if (source.query.kind === "commit") {
    query = ["commit", source.query.oid];
  } else {
    query = ["branch", source.query.targetRef];
  }
  return [source.contextId, source.gitRootPath, query, source.path];
}

export function getGitDiffPanelSourceIdentity(
  source: GitDiffPanelSource
): string {
  return JSON.stringify(getGitDiffPanelSourceIdentityTuple(source));
}

export const gitReviewIndexEntrySchema = z
  .strictObject({
    additions: gitReviewCountSchema,
    deletions: gitReviewCountSchema,
    entryKey: z.string().min(1).max(512),
    groups: z.array(gitReviewGroupSchema).min(1).max(3),
    groupStatuses: z.partialRecord(
      gitReviewGroupSchema,
      gitReviewFileStatusSchema
    ),
    oldPaths: z.array(gitReviewRelativePathSchema).max(3),
    path: gitReviewRelativePathSchema,
    status: gitReviewFileStatusSchema,
  })
  .superRefine((entry, context) => {
    const uniqueGroups = new Set<string>(entry.groups);
    const statusGroups = Object.keys(entry.groupStatuses);
    const orderedGroups = GIT_REVIEW_GROUP_ORDER.filter((group) =>
      uniqueGroups.has(group)
    );
    if (
      uniqueGroups.size !== entry.groups.length ||
      orderedGroups.some((group, index) => entry.groups[index] !== group) ||
      statusGroups.length !== uniqueGroups.size ||
      statusGroups.some((group) => !uniqueGroups.has(group))
    ) {
      context.addIssue({
        code: "custom",
        message: "groups and groupStatuses must contain the same unique groups",
      });
      return;
    }
    const hasConflictGroup = uniqueGroups.has("conflict");
    const hasCommitGroup = uniqueGroups.has("commit");
    const hasBranchGroup = uniqueGroups.has("branch");
    const nonConflictHasConflictedStatus = Object.entries(
      entry.groupStatuses
    ).some(
      ([group, status]) => group !== "conflict" && status === "conflicted"
    );
    if (
      (hasConflictGroup &&
        (entry.groups.length !== 1 ||
          entry.groupStatuses.conflict !== "conflicted")) ||
      nonConflictHasConflictedStatus
    ) {
      context.addIssue({
        code: "custom",
        message:
          "conflict must be the sole group with conflicted status, and conflicted cannot label other groups",
      });
      return;
    }
    if (
      (hasCommitGroup && entry.groups.length !== 1) ||
      (hasBranchGroup && entry.groups.length !== 1) ||
      (hasCommitGroup && hasBranchGroup)
    ) {
      context.addIssue({
        code: "custom",
        message: "commit and branch must each be the sole group",
      });
      return;
    }
    const aggregateStatus = GIT_REVIEW_STATUS_PRIORITY.find((status) =>
      Object.values(entry.groupStatuses).includes(status)
    );
    if (aggregateStatus !== entry.status) {
      context.addIssue({
        code: "custom",
        message: "status must match the documented group status priority",
      });
    }
  });
export type GitReviewIndexEntry = z.infer<typeof gitReviewIndexEntrySchema>;

export const gitReviewIndexOkSchema = z
  .strictObject({
    durationMs: z.number().nonnegative(),
    entries: z.array(gitReviewIndexEntrySchema).max(2000),
    gitRootPath: gitReviewRootPathSchema,
    kind: z.literal("ok"),
    query: gitReviewResolvedQuerySchema,
    revision: gitReviewRevisionSchema,
    sourceQuery: gitReviewPanelQuerySchema,
    warnings: z
      .array(gitReviewWarningSchema)
      .max(4)
      .refine(
        (warnings) =>
          new Set(warnings.map((warning) => warning.code)).size ===
          warnings.length,
        "Warning codes must be unique"
      ),
  })
  .superRefine((result, context) => {
    if (result.query.kind !== result.sourceQuery.kind) {
      context.addIssue({
        code: "custom",
        message: "resolved and source query kinds must match",
      });
      return;
    }
    if (result.query.kind === "uncommitted") {
      if (
        result.sourceQuery.kind !== "uncommitted" ||
        !sameUncommittedGroups(result.query.groups, result.sourceQuery.groups)
      ) {
        context.addIssue({
          code: "custom",
          message: "uncommitted source and resolved groups must match",
        });
        return;
      }
      const requestedGroups = new Set(result.query.groups);
      if (
        result.entries.some(
          (entry) =>
            !(
              (entry.groups.length === 1 && entry.groups[0] === "conflict") ||
              entry.groups.every(
                (group) =>
                  (group === "unstaged" || group === "staged") &&
                  requestedGroups.has(group)
              )
            )
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "uncommitted entries must match requested groups",
        });
      }
      return;
    }
    const expectedGroup = result.query.kind;
    if (
      (result.query.kind === "commit" &&
        (result.sourceQuery.kind !== "commit" ||
          result.sourceQuery.oid !== result.query.commitOid)) ||
      (result.query.kind === "branch" &&
        (result.sourceQuery.kind !== "branch" ||
          result.sourceQuery.targetRef !== result.query.targetRef))
    ) {
      context.addIssue({
        code: "custom",
        message: "source query must match the resolved commit or branch",
      });
      return;
    }
    if (
      result.entries.some(
        (entry) =>
          entry.groups.length !== 1 || entry.groups[0] !== expectedGroup
      )
    ) {
      context.addIssue({
        code: "custom",
        message: `${expectedGroup} entries must use their sole query group`,
      });
    }
  });

function sameUncommittedGroups(
  left: readonly ("unstaged" | "staged")[],
  right: readonly ("unstaged" | "staged")[]
): boolean {
  return (
    left.length === right.length &&
    left.every((group, index) => right[index] === group)
  );
}
export type GitReviewIndexOk = z.infer<typeof gitReviewIndexOkSchema>;

export const gitReviewIndexResultSchema = z.union([
  gitReviewIndexOkSchema,
  gitReviewFailureSchema,
]);
export type GitReviewIndexResult = z.infer<typeof gitReviewIndexResultSchema>;
