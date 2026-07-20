import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import { Label } from "@pier/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@pier/ui/select.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitDiffBranchOption } from "@shared/contracts/git.ts";
import type { GitReviewTarget } from "@shared/contracts/git-review.ts";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { pluginText } from "./git-plugin-text.ts";
import {
  GitReviewBranchCombobox,
  GitReviewCommitCombobox,
} from "./git-review-scope-comboboxes.tsx";

/** 与 loomdesk 一致的默认对比分支优先级(排除当前分支)。 */
const DEFAULT_TARGET_BRANCH_NAMES = [
  "main",
  "master",
  "origin/main",
  "origin/master",
];

type GitReviewScopeKind = GitReviewTarget["kind"];

export interface GitReviewUncommittedFilter {
  readonly staged: boolean;
  readonly unstaged: boolean;
}

export const DEFAULT_UNCOMMITTED_FILTER: GitReviewUncommittedFilter = {
  staged: true,
  unstaged: true,
};

function preferredTargetBranch(
  branches: readonly GitDiffBranchOption[]
): GitDiffBranchOption | null {
  for (const name of DEFAULT_TARGET_BRANCH_NAMES) {
    const match = branches.find(
      (branch) => branch.name === name && !branch.current
    );
    if (match) {
      return match;
    }
  }
  return branches.find((branch) => !branch.current) ?? null;
}

/**
 * Changes 面板 header 左侧的 review 目标切换(对齐 loomdesk toolbar):
 * 第一段是 scope Select(未提交/提交/分支);uncommitted 附带
 * 未暂存/已暂存过滤,commit/branch 在右侧内联第二段 combobox,并在
 * 切换 scope 时自动选中默认目标(最新提交 / main·master 系默认分支)。
 */
export function GitReviewScopeSwitcher({
  context,
  gitRootPath,
  onSelectTarget,
  onUncommittedFilterChange,
  target,
  uncommittedFilter,
}: {
  readonly context: RendererPluginContext;
  readonly gitRootPath: string;
  readonly onSelectTarget: (target: GitReviewTarget) => void;
  readonly onUncommittedFilterChange: (
    filter: GitReviewUncommittedFilter
  ) => void;
  readonly target: GitReviewTarget;
  readonly uncommittedFilter: GitReviewUncommittedFilter;
}): React.JSX.Element {
  // 切到 commit/branch 后 target 尚未变化(自动/手动选定目标前);pending 驱动 UI。
  const [pendingKind, setPendingKind] = useState<GitReviewScopeKind | null>(
    null
  );
  const kind = pendingKind ?? target.kind;
  // 自动选取效果只应由 pendingKind 驱动;回调经 ref 消费避免随渲染重跑。
  const onSelectTargetRef = useRef(onSelectTarget);
  onSelectTargetRef.current = onSelectTarget;
  const scopeLabels: Record<GitReviewScopeKind, string> = {
    branch: pluginText(context, "reviewScopeBranch", "Branch"),
    commit: pluginText(context, "reviewScopeCommit", "Commit"),
    uncommitted: pluginText(context, "reviewScopeUncommitted", "Uncommitted"),
  };

  // 对齐 loomdesk:切到 commit scope 未选目标时自动选最新提交。
  // 搜索失败或无候选时回退 pending 并提示,避免 header 显示新 scope
  // 而面板仍渲染旧目标的脱节状态。
  useEffect(() => {
    if (pendingKind !== "commit") {
      return;
    }
    let cancelled = false;
    const revert = (key: string, fallback: string) => {
      if (cancelled) {
        return;
      }
      setPendingKind(null);
      context.notifications.error(pluginText(context, key, fallback));
    };
    context.git
      .searchCommits(gitRootPath, { limit: 1, query: "" })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status !== "ok") {
          revert(
            "reviewScopeCommitsLoadFailed",
            "Couldn't load commits. Try again."
          );
          return;
        }
        const latest = result.items[0];
        if (!latest) {
          revert(
            "reviewScopeNoCommitsToReview",
            "This repository has no commits to review."
          );
          return;
        }
        setPendingKind(null);
        onSelectTargetRef.current({ kind: "commit", oid: latest.hash });
      })
      .catch(() => {
        revert(
          "reviewScopeCommitsLoadFailed",
          "Couldn't load commits. Try again."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [context, gitRootPath, pendingKind]);

  // 对齐 loomdesk:切到 branch scope 未选目标时自动选默认分支(main/master 系)。
  // 失败回退语义同上方 commit 效果。
  useEffect(() => {
    if (pendingKind !== "branch") {
      return;
    }
    let cancelled = false;
    const revert = (key: string, fallback: string) => {
      if (cancelled) {
        return;
      }
      setPendingKind(null);
      context.notifications.error(pluginText(context, key, fallback));
    };
    context.git
      .searchBranches(gitRootPath, {
        diffMode: "commitGraph",
        limit: 1000,
        query: "",
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status !== "ok") {
          revert(
            "reviewScopeBranchesLoadFailed",
            "Couldn't load branches. Try again."
          );
          return;
        }
        const preferred = preferredTargetBranch(result.items);
        if (!preferred) {
          revert(
            "reviewScopeNoOtherBranches",
            "No other branches to compare against."
          );
          return;
        }
        setPendingKind(null);
        onSelectTargetRef.current({ kind: "branch", ref: preferred.name });
      })
      .catch(() => {
        revert(
          "reviewScopeBranchesLoadFailed",
          "Couldn't load branches. Try again."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [context, gitRootPath, pendingKind]);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select
        onValueChange={(value) => {
          if (value === "uncommitted") {
            setPendingKind(null);
            if (target.kind !== "uncommitted") {
              onSelectTarget({ kind: "uncommitted" });
            }
            return;
          }
          if (value === "commit" || value === "branch") {
            setPendingKind(value === target.kind ? null : value);
          }
        }}
        value={kind}
      >
        {/* kit 无 sm 触发器实体样式;header 24px 密度沿 panel-overflow 的
            asChild+Button 先例。 */}
        <SelectTrigger
          aria-label={pluginText(
            context,
            "reviewScopeSwitcherLabel",
            "Select review target"
          )}
          asChild
        >
          <Button
            data-testid="git-review-scope-switcher"
            size="xs"
            type="button"
            variant="ghost"
          >
            <span className="min-w-0 truncate">{scopeLabels[kind]}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </SelectTrigger>
        <SelectContent align="start" position="popper">
          <SelectGroup>
            <SelectItem value="uncommitted">
              {scopeLabels.uncommitted}
            </SelectItem>
            <SelectItem value="commit">{scopeLabels.commit}</SelectItem>
            <SelectItem value="branch">{scopeLabels.branch}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {kind === "uncommitted" ? (
        <GitReviewUncommittedFilterControls
          context={context}
          filter={uncommittedFilter}
          onChange={onUncommittedFilterChange}
        />
      ) : null}
      {kind === "commit" ? (
        <GitReviewCommitCombobox
          context={context}
          gitRootPath={gitRootPath}
          onPick={(commit) => {
            setPendingKind(null);
            onSelectTarget({ kind: "commit", oid: commit.hash });
          }}
          selectedOid={target.kind === "commit" ? target.oid : null}
        />
      ) : null}
      {kind === "branch" ? (
        <GitReviewBranchCombobox
          context={context}
          gitRootPath={gitRootPath}
          onPick={(branch) => {
            setPendingKind(null);
            onSelectTarget({ kind: "branch", ref: branch.name });
          }}
          selectedRef={target.kind === "branch" ? target.ref : null}
        />
      ) : null}
    </div>
  );
}

/** uncommitted scope 的分组过滤(对齐 loomdesk 的未暂存/已暂存复选)。 */
function GitReviewUncommittedFilterControls({
  context,
  filter,
  onChange,
}: {
  readonly context: RendererPluginContext;
  readonly filter: GitReviewUncommittedFilter;
  readonly onChange: (filter: GitReviewUncommittedFilter) => void;
}): React.JSX.Element {
  const unstagedId = useId();
  const stagedId = useId();
  return (
    <div className="flex shrink-0 items-center gap-3 px-1">
      {/* Label 而非 FieldLabel:后者的 has-data-checked 底色语义面向表单场景,
          header 内联过滤不需要选中态高亮。 */}
      <Label htmlFor={unstagedId}>
        <Checkbox
          checked={filter.unstaged}
          data-testid="git-review-filter-unstaged"
          id={unstagedId}
          onCheckedChange={(checked) => {
            onChange({ ...filter, unstaged: checked === true });
          }}
        />
        {pluginText(context, "reviewFilterUnstaged", "Unstaged")}
      </Label>
      <Label htmlFor={stagedId}>
        <Checkbox
          checked={filter.staged}
          data-testid="git-review-filter-staged"
          id={stagedId}
          onCheckedChange={(checked) => {
            onChange({ ...filter, staged: checked === true });
          }}
        />
        {pluginText(context, "reviewFilterStaged", "Staged")}
      </Label>
    </div>
  );
}
