/**
 * worktree 创建弹窗的表单逻辑与纯展示子组件(与 overlay 壳分离,控文件体积)。
 */
import { Badge } from "@pier/ui/badge.tsx";
import { FieldDescription } from "@pier/ui/field.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitBranchRef } from "@shared/contracts/git.ts";
import type { WorktreeCreationDefaults } from "@shared/contracts/worktree.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  deriveWorktreeCreationFromSlug,
} from "@shared/worktree-naming.ts";
import { z } from "zod";

export const HEAD_SENTINEL = "__head__";
const BRANCH_LIKE_PATTERN = /^[A-Za-z0-9._/-]+$/;

export type CreateMode = "ai" | "custom";
export type SubmitPhase = "creating" | "generating" | "idle";

export interface WorktreeCreateOverlayData {
  branches: readonly GitBranchRef[];
  defaults: WorktreeCreationDefaults;
  existingBranches: readonly string[];
  existingNames: readonly string[];
  mainPath: string;
}

export interface FormValues {
  base: string;
  branch: string;
  mode: CreateMode;
  text: string;
}

export type TextFn = (
  key: string,
  values: Record<string, number | string> | undefined,
  fallback: string
) => string;

function validateCustomBranch(
  branch: string,
  existingBranches: readonly string[],
  text: TextFn
): string | null {
  if (!branch) {
    return text("errorBranchRequired", undefined, "Enter a branch name");
  }
  if (!BRANCH_LIKE_PATTERN.test(branch)) {
    return text(
      "errorBranchInvalid",
      undefined,
      "Branch names may only contain letters, digits and . _ / -"
    );
  }
  if (existingBranches.includes(branch)) {
    return text("errorBranchExists", undefined, "Branch already exists");
  }
  return null;
}

export function buildFormSchema(
  existingBranches: readonly string[],
  text: TextFn
) {
  return z
    .object({
      base: z.string(),
      branch: z.string(),
      mode: z.enum(["ai", "custom"]),
      text: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.mode === "ai" && values.text.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: text(
            "errorTaskRequired",
            undefined,
            "Enter a task description"
          ),
          path: ["text"],
        });
      }
      if (values.mode !== "custom") {
        return;
      }
      const branchError = validateCustomBranch(
        values.branch.trim(),
        existingBranches,
        text
      );
      if (branchError) {
        ctx.addIssue({
          code: "custom",
          message: branchError,
          path: ["branch"],
        });
      }
    });
}

interface ResolveDraftArgs {
  data: WorktreeCreateOverlayData;
  suggestBranch: RendererPluginContext["ai"]["suggestBranch"];
  text: TextFn;
  values: FormValues;
}

export type ResolveDraftResult =
  | { draft: WorktreeCreationDraft }
  | { error: string };

/** custom 模式同步派生;ai 模式先调 AI 生成 slug 再规整/去重。 */
export async function resolveSubmitDraft({
  data,
  suggestBranch,
  text,
  values,
}: ResolveDraftArgs): Promise<ResolveDraftResult> {
  const shared = {
    existingBranches: data.existingBranches,
    existingNames: data.existingNames,
  };
  if (values.mode === "custom") {
    return {
      draft: deriveWorktreeCreation({ ...shared, input: values.branch.trim() }),
    };
  }
  const suggestion = await suggestBranch({ text: values.text.trim() });
  if (suggestion.status !== "ok") {
    return {
      error: text(
        `generateFailed.${suggestion.reason}`,
        { message: suggestion.message },
        "Agent invocation failed: {{message}}"
      ),
    };
  }
  const draft = deriveWorktreeCreationFromSlug(suggestion.slug, shared);
  if (!draft) {
    return {
      error: text(
        "generateFailed.invalid_response",
        undefined,
        "AI returned no usable branch name, try again"
      ),
    };
  }
  return { draft };
}

export function AiFieldDescription({
  agentLabel,
  aiConfigured,
  rootPath,
  statusLoading,
  text,
}: {
  agentLabel: string;
  aiConfigured: boolean;
  rootPath: string;
  statusLoading: boolean;
  text: TextFn;
}) {
  if (aiConfigured) {
    return (
      <FieldDescription>
        {text(
          "taskHint",
          { agent: agentLabel, root: rootPath },
          "Default agent ({{agent}}) will generate a branch name from the task description and create an isolated worktree under {{root}}."
        )}
      </FieldDescription>
    );
  }
  return (
    <FieldDescription className="text-destructive">
      {statusLoading
        ? text("aiChecking", undefined, "Checking available agents…")
        : text(
            "aiUnconfigured",
            undefined,
            "No command-line agent is available for naming. Install or enable one, or switch to manual naming."
          )}
    </FieldDescription>
  );
}

export function PrepareBadges({
  defaults,
  text,
}: {
  defaults: WorktreeCreationDefaults;
  text: TextFn;
}) {
  const hasCopy = defaults.copyPatterns.length > 0;
  const hasSetup = defaults.setupCommand.trim() !== "";
  if (!(hasCopy || hasSetup)) {
    return null;
  }
  return (
    <FieldDescription className="flex flex-wrap items-center gap-1.5">
      <span>{text("prepareLabel", undefined, "Before creating")}</span>
      {hasCopy ? (
        <Badge variant="secondary">
          {text(
            "prepareCopy",
            { count: defaults.copyPatterns.length },
            "Copy {{count}} ignored file entries"
          )}
        </Badge>
      ) : null}
      {hasSetup ? (
        <Badge variant="secondary">
          {text("prepareSetup", undefined, "Run setup command")}
        </Badge>
      ) : null}
    </FieldDescription>
  );
}

export function confirmButtonContent(phase: SubmitPhase, text: TextFn) {
  if (phase === "generating") {
    return (
      <>
        <Spinner aria-hidden="true" />
        {text("aiGenerating", undefined, "Generating…")}
      </>
    );
  }
  if (phase === "creating") {
    return (
      <>
        <Spinner aria-hidden="true" />
        {text("creating", undefined, "Creating…")}
      </>
    );
  }
  return text("confirm", undefined, "Create");
}
