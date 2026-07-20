import { z } from "zod";
import {
  GIT_REVIEW_GROUP_ORDER,
  GIT_REVIEW_MAX_SECTIONS,
  GIT_REVIEW_STATUS_PRIORITY,
  gitReviewFailureSchema,
  gitReviewFileStatusSchema,
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
  gitReviewSectionKeySchema,
  gitReviewWarningSchema,
} from "./primitives.ts";

const gitReviewCommitOidSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u, "Expected a full commit OID");

/** 分支/ref 输入的窄校验：拒绝选项注入与控制字符；真实存在性由 main rev-parse 决定。 */
const gitReviewBranchRefSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (ref) =>
      !(
        ref.startsWith("-") ||
        ref.includes("\0") ||
        ref.includes("\n") ||
        ref.includes("\r")
      ),
    "Expected a safe Git ref"
  );

/**
 * Review 目标：
 * - uncommitted: 工作区未提交变更(unstaged/staged/conflict 分组)
 * - commit: 单个 commit 相对首父(根提交相对空树)的 range diff(committed 分组)
 * - branch: merge-base(HEAD, ref)..HEAD 的 range diff(committed 分组)
 */
export const gitReviewTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("uncommitted") }),
  z.strictObject({ kind: z.literal("commit"), oid: gitReviewCommitOidSchema }),
  z.strictObject({ kind: z.literal("branch"), ref: gitReviewBranchRefSchema }),
]);
export type GitReviewTarget = z.infer<typeof gitReviewTargetSchema>;

export const gitReviewScopeSchema = z.strictObject({
  contextId: z.string().min(1).max(256),
  gitRootPath: gitReviewRootPathSchema,
  /** 缺省按 uncommitted 解析，兼容既有面板持久化的 source 参数。 */
  target: gitReviewTargetSchema.default({ kind: "uncommitted" }),
});
export type GitReviewScope = z.infer<typeof gitReviewScopeSchema>;

export const gitReviewFileSourceSchema = gitReviewScopeSchema.extend({
  oldPaths: z.array(gitReviewRelativePathSchema).max(3),
  path: gitReviewRelativePathSchema,
});
export type GitReviewFileSource = z.infer<typeof gitReviewFileSourceSchema>;

type GitReviewFileSourceIdentityTuple = readonly [
  contextId: string,
  gitRootPath: string,
  target: GitReviewTarget,
  path: string,
  oldPaths: readonly string[],
];

/**
 * 序列化已规范化的 source 值；gitRootPath 的 realpath/case canonicalization
 * 仍由 T2 main identity 所有者在调用前完成，renderer 不得把词法路径当授权身份。
 */
function getGitReviewFileSourceIdentityTuple(
  input: GitReviewFileSource
): GitReviewFileSourceIdentityTuple {
  const source = gitReviewFileSourceSchema.parse(input);
  return [
    source.contextId,
    source.gitRootPath,
    source.target,
    source.path,
    source.oldPaths,
  ];
}

export function getGitReviewFileSourceIdentity(
  source: GitReviewFileSource
): string {
  return JSON.stringify(getGitReviewFileSourceIdentityTuple(source));
}

export const gitReviewRenderSlotSchema = z.strictObject({
  group: z.enum(GIT_REVIEW_GROUP_ORDER),
  oldPath: gitReviewRelativePathSchema.nullable(),
  sectionKey: gitReviewSectionKeySchema,
  status: gitReviewFileStatusSchema,
  targetPath: gitReviewRelativePathSchema,
});

export const gitReviewIndexEntrySchema = z
  .strictObject({
    entryKey: z.string().min(1).max(512),
    oldPaths: z.array(gitReviewRelativePathSchema).max(3),
    path: gitReviewRelativePathSchema,
    renderSlots: z
      .array(gitReviewRenderSlotSchema)
      .min(1)
      .max(GIT_REVIEW_MAX_SECTIONS),
    status: gitReviewFileStatusSchema,
  })
  .superRefine((entry, context) => {
    const sectionKeys = new Set<string>();
    const groups = new Set<string>();
    let previousGroupIndex = -1;
    for (const [index, slot] of entry.renderSlots.entries()) {
      const groupIndex = GIT_REVIEW_GROUP_ORDER.indexOf(slot.group);
      if (sectionKeys.has(slot.sectionKey) || groups.has(slot.group)) {
        context.addIssue({
          code: "custom",
          message: "Render slots must have unique section keys and groups",
          path: ["renderSlots", index],
        });
      }
      if (groupIndex <= previousGroupIndex) {
        context.addIssue({
          code: "custom",
          message: "Render slots must follow Git review group order",
          path: ["renderSlots", index],
        });
      }
      if (
        slot.group === "conflict" &&
        (slot.oldPath !== null || slot.status !== "conflicted")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Conflict render slots require conflicted status and no old path",
          path: ["renderSlots", index],
        });
      }
      sectionKeys.add(slot.sectionKey);
      groups.add(slot.group);
      previousGroupIndex = groupIndex;
    }
    const aggregateStatus = GIT_REVIEW_STATUS_PRIORITY.find((status) =>
      entry.renderSlots.some((slot) => slot.status === status)
    );
    if (aggregateStatus !== entry.status) {
      context.addIssue({
        code: "custom",
        message:
          "Entry status must match the highest-priority render slot status",
        path: ["status"],
      });
    }
  });
export type GitReviewIndexEntry = z.infer<typeof gitReviewIndexEntrySchema>;

export const gitReviewIndexOkSchema = z.strictObject({
  entries: z.array(gitReviewIndexEntrySchema),
  kind: z.literal("ok"),
  warnings: z
    .array(gitReviewWarningSchema)
    .max(4)
    .refine(
      (warnings) =>
        new Set(warnings.map((warning) => warning.code)).size ===
        warnings.length,
      "Warning codes must be unique"
    ),
});
export type GitReviewIndexOk = z.infer<typeof gitReviewIndexOkSchema>;

export const gitReviewIndexResultSchema = z.union([
  gitReviewIndexOkSchema,
  gitReviewFailureSchema,
]);
export type GitReviewIndexResult = z.infer<typeof gitReviewIndexResultSchema>;
