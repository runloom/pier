/**
 * 审查 panel tabChangeSummary 写入策略（纯函数，供 effect 与单测共用）。
 *
 * - 写进 params 供 resolveTab → tab.trailing；属**短暂呈现态**，layout 序列化须剥离。
 * - sourceKey 变化时必须先清空，避免新标题 + 旧 +/−。
 * - 同 sourceKey 的 pending 保留上次摘要，避免刷新闪烁。
 * - 未提交 tab 只采工作树相对 HEAD 的净变化（与状态栏同源）；commit/branch 采审查 index。
 */

import type {
  GitReviewIndexOk,
  GitReviewTarget,
} from "@shared/contracts/git/review.ts";
import type { GitChangeSummary } from "@shared/contracts/git.ts";
import {
  GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM,
  gitReviewTabChangeSummary,
} from "./changes-tab-title.ts";

export { GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM } from "./changes-tab-title.ts";

export type TabChangeSummaryIndexState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "loaded";
      readonly result: {
        readonly groupSummaries: GitReviewIndexOk["groupSummaries"];
      };
    };

export type TabChangeSummaryWorkingTreeState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "loaded"; readonly summary: GitChangeSummary };

export function sameTabChangeSummary(
  left: unknown,
  right: GitChangeSummary | null
): boolean {
  if (right === null) {
    return left === null || left === undefined;
  }
  if (!(left && typeof left === "object")) {
    return false;
  }
  const record = left as Record<string, unknown>;
  if (record.kind !== right.kind) {
    return false;
  }
  if (right.kind === "lineDelta") {
    return (
      record.kind === "lineDelta" &&
      record.insertions === right.insertions &&
      record.deletions === right.deletions &&
      record.changedFiles === right.changedFiles &&
      record.excludedFiles === right.excludedFiles
    );
  }
  if (right.kind !== "filesOnly" || record.kind !== "filesOnly") {
    return false;
  }
  if (
    record.changedFiles !== right.changedFiles ||
    record.omittedFiles !== right.omittedFiles
  ) {
    return false;
  }
  const leftReasons = Array.isArray(record.reasons) ? record.reasons : null;
  if (!(leftReasons && leftReasons.length === right.reasons.length)) {
    return false;
  }
  return right.reasons.every((reason, index) => leftReasons[index] === reason);
}

export type TabChangeSummaryWritePlan =
  | { readonly action: "noop" }
  | { readonly action: "write"; readonly summary: GitChangeSummary | null };

type ResolvedTabChangeSummary =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly summary: GitChangeSummary | null };

function resolveTabChangeSummary(input: {
  readonly indexState: TabChangeSummaryIndexState;
  readonly source: { readonly target: GitReviewTarget } | null;
  readonly workingTreeState: TabChangeSummaryWorkingTreeState;
}): ResolvedTabChangeSummary {
  const { indexState, source, workingTreeState } = input;
  if (!source) {
    return { kind: "ready", summary: null };
  }
  if (source.target.kind === "uncommitted") {
    if (workingTreeState.kind === "loaded") {
      return { kind: "ready", summary: workingTreeState.summary };
    }
    if (workingTreeState.kind === "error") {
      return { kind: "ready", summary: null };
    }
    // loading 与 idle 均为 pending。生产 `tabWorkingTreeStateForTarget`
    // 对未提交不会返回 idle；idle 只出现在调用方尚未接入工作树状态时。
    return { kind: "pending" };
  }
  if (indexState.kind === "loaded") {
    return {
      kind: "ready",
      summary:
        gitReviewTabChangeSummary(source.target, {
          groupSummaries: indexState.result.groupSummaries,
        }) ?? null,
    };
  }
  if (indexState.kind === "error") {
    return { kind: "ready", summary: null };
  }
  return { kind: "pending" };
}

/**
 * 根据工作树 / 审查 index 与 sourceKey 决定是否更新 tabChangeSummary。
 * lastSourceKey 是上一次成功写入/清空所绑定的 sourceKey。
 */
export function planTabChangeSummaryWrite(input: {
  readonly currentParam: unknown;
  readonly indexState: TabChangeSummaryIndexState;
  readonly lastSourceKey: string | null;
  readonly source: {
    readonly target: GitReviewTarget;
  } | null;
  readonly sourceKey: string | null;
  readonly workingTreeState: TabChangeSummaryWorkingTreeState;
}): {
  readonly nextLastSourceKey: string | null;
  readonly plan: TabChangeSummaryWritePlan;
} {
  const {
    currentParam,
    indexState,
    lastSourceKey,
    source,
    sourceKey,
    workingTreeState,
  } = input;

  if (!source) {
    const plan: TabChangeSummaryWritePlan = sameTabChangeSummary(
      currentParam,
      null
    )
      ? { action: "noop" }
      : { action: "write", summary: null };
    return { nextLastSourceKey: null, plan };
  }

  const resolved = resolveTabChangeSummary({
    indexState,
    source,
    workingTreeState,
  });
  if (resolved.kind === "pending") {
    if (lastSourceKey !== sourceKey) {
      const plan: TabChangeSummaryWritePlan = sameTabChangeSummary(
        currentParam,
        null
      )
        ? { action: "noop" }
        : { action: "write", summary: null };
      return { nextLastSourceKey: sourceKey, plan };
    }
    return { nextLastSourceKey: lastSourceKey, plan: { action: "noop" } };
  }

  const plan: TabChangeSummaryWritePlan = sameTabChangeSummary(
    currentParam,
    resolved.summary
  )
    ? { action: "noop" }
    : { action: "write", summary: resolved.summary };
  return { nextLastSourceKey: sourceKey, plan };
}

export function tabWorkingTreeStateForTarget(
  target: GitReviewTarget | undefined,
  gitStatus:
    | { readonly kind: "loading" }
    | { readonly kind: "error" }
    | {
        readonly kind: "loaded";
        readonly status: { readonly changeSummary: GitChangeSummary };
      }
): TabChangeSummaryWorkingTreeState {
  if (target?.kind !== "uncommitted") {
    return { kind: "idle" };
  }
  if (gitStatus.kind === "loaded") {
    return { kind: "loaded", summary: gitStatus.status.changeSummary };
  }
  if (gitStatus.kind === "error") {
    return { kind: "error" };
  }
  return { kind: "loading" };
}

/** 从任意 params 对象剥离短暂 tabChangeSummary（layout 序列化用）。 */
export function stripTabChangeSummaryFromParams(
  params: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!(params && GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM in params)) {
    return params;
  }
  const { [GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM]: _drop, ...rest } = params;
  return rest;
}
