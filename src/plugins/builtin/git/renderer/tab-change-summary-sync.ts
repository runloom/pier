/**
 * 审查 panel tabChangeSummary 写入策略（纯函数，供 effect 与单测共用）。
 *
 * - 写进 params 供 resolveTab → tab.trailing；属**短暂呈现态**，layout 序列化须剥离。
 * - sourceKey 变化时必须先清空，避免新标题 + 旧 +/−。
 * - 同 sourceKey 的 loading 保留上次摘要，避免刷新闪烁。
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

/**
 * 根据 index 状态与 sourceKey 决定是否更新 tabChangeSummary。
 * lastSourceKey 是上一次成功写入/清空所绑定的 sourceKey。
 */
export function planTabChangeSummaryWrite(input: {
  readonly currentParam: unknown;
  readonly lastSourceKey: string | null;
  readonly source: {
    readonly target: GitReviewTarget;
  } | null;
  readonly sourceKey: string | null;
  readonly state:
    | { readonly kind: "loading" }
    | { readonly kind: "error" }
    | {
        readonly kind: "loaded";
        readonly result: {
          readonly groupSummaries: GitReviewIndexOk["groupSummaries"];
        };
      };
}): {
  readonly nextLastSourceKey: string | null;
  readonly plan: TabChangeSummaryWritePlan;
} {
  const { currentParam, lastSourceKey, source, sourceKey, state } = input;

  if (!source) {
    const plan: TabChangeSummaryWritePlan = sameTabChangeSummary(
      currentParam,
      null
    )
      ? { action: "noop" }
      : { action: "write", summary: null };
    return { nextLastSourceKey: null, plan };
  }

  if (state.kind === "loading") {
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

  if (state.kind === "error") {
    const plan: TabChangeSummaryWritePlan = sameTabChangeSummary(
      currentParam,
      null
    )
      ? { action: "noop" }
      : { action: "write", summary: null };
    return { nextLastSourceKey: sourceKey, plan };
  }

  const summary =
    gitReviewTabChangeSummary(source.target, state.result.groupSummaries) ??
    null;
  const plan: TabChangeSummaryWritePlan = sameTabChangeSummary(
    currentParam,
    summary
  )
    ? { action: "noop" }
    : { action: "write", summary };
  return { nextLastSourceKey: sourceKey, plan };
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
