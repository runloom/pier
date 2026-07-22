/**
 * worktree 创建弹窗的表单逻辑与纯展示子组件(与 overlay 壳分离,控文件体积)。
 */
import { Badge } from "@pier/ui/badge.tsx";
import { FieldDescription } from "@pier/ui/field.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GIT_WORKTREE_BRANCH_NAME_PROMPT_SETTING_KEY } from "@plugins/builtin/git/settings.ts";
import { type AgentKind, agentKindSchema } from "@shared/contracts/agent.ts";
import type { GitBranchRef } from "@shared/contracts/git.ts";
import type { WorktreeCreationDefaults } from "@shared/contracts/worktree.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  deriveWorktreeCreationFromSlug,
  isValidGitBranchName,
  sanitizeBranchCandidate,
} from "@shared/worktree-naming.ts";
import { z } from "zod";

export const HEAD_SENTINEL = "__head__";
const TASK_PLACEHOLDER = "{{task}}";
const PROJECT_ROOT_PLACEHOLDER = "{{projectRootPath}}";
const MAX_BRANCH_CANDIDATE_CHARS = 64;

export const FALLBACK_BRANCH_NAME_PROMPT = [
  "Turn this software task description (any language) into a short git branch name.",
  "Use the current repository context and follow any loaded project or agent instructions that define branch naming conventions.",
  "Examples of project instructions include AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, OpenCode rules, and Copilot repository instructions.",
  "Reply with ONLY one branch name on the last line of your output:",
  "prefer 2-5 lowercase English words, ASCII letters and digits plus . _ / - only,",
  "include a required project prefix such as feature/ only when project instructions require it,",
  "no quotes, no spaces, no trailing punctuation, at most 64 characters.",
  "Summarize the task's intent in English.",
  "Task: {{task}}",
].join("\n");

export type CreateMode = "ai" | "custom";

export interface WorktreeCreateOverlayData {
  branches: readonly GitBranchRef[];
  defaults: WorktreeCreationDefaults;

  existingBranches: readonly string[];
  existingNames: readonly string[];
  mainPath: string;
}

export interface FormValues {
  agentId: AgentKind | "";
  base: string;
  branch: string;
  mode: CreateMode;
  startTask: boolean;
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
  if (!isValidGitBranchName(branch)) {
    return text(
      "errorBranchInvalid",
      undefined,
      "Enter a valid Git branch name using letters, digits and . _ / -"
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
      agentId: z.union([agentKindSchema, z.literal("")]),
      base: z.string(),
      branch: z.string(),
      mode: z.enum(["ai", "custom"]),
      startTask: z.boolean(),
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
      if (values.mode === "ai" && values.startTask && values.agentId === "") {
        ctx.addIssue({
          code: "custom",
          message: text(
            "errorAgentRequired",
            undefined,
            "Choose an agent to start the task"
          ),
          path: ["agentId"],
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
  branchNamePromptTemplate: string;
  data: WorktreeCreateOverlayData;
  generateText: RendererPluginContext["ai"]["generateText"];
  text: TextFn;
  values: FormValues;
}

export type ResolveDraftResult =
  | { draft: WorktreeCreationDraft }
  | { error: string };

export function buildBranchNamePrompt({
  projectRootPath,
  template,
  text,
}: {
  projectRootPath: string;
  template: string;
  text: string;
}): string {
  const base = template.trim() || FALLBACK_BRANCH_NAME_PROMPT;
  const withProject = base.replaceAll(
    PROJECT_ROOT_PLACEHOLDER,
    projectRootPath
  );
  if (withProject.includes(TASK_PLACEHOLDER)) {
    return withProject.replaceAll(TASK_PLACEHOLDER, text);
  }
  return `${withProject}\n\nTask: ${text}`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 剥离终端 ANSI 转义序列需要匹配 ESC 控制符
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function extractAnswerLine(stdout: string): string {
  const lines = stdout
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}

function truncateBranchCandidate(candidate: string): string {
  if (candidate.length <= MAX_BRANCH_CANDIDATE_CHARS) {
    return candidate;
  }
  const truncated = sanitizeBranchCandidate(
    candidate.slice(0, MAX_BRANCH_CANDIDATE_CHARS)
  );
  return truncated.replace(/[-./]+$/g, "");
}

export function normalizeBranchSuggestion(raw: string): string {
  const cleaned = sanitizeBranchCandidate(raw.toLowerCase());
  if (!cleaned) {
    return "";
  }
  const truncated = truncateBranchCandidate(cleaned);
  return isValidGitBranchName(truncated) ? truncated : "";
}

const BRANCH_LABEL_PATTERN = /^branch(?:\s+name)?\s*:\s*/i;
const LEADING_LIST_MARKER_PATTERN = /^[-*]\s+/;
const SURROUNDING_MARKUP_PATTERN = /^[`"']+|[`"'.,;:]+$/g;

export function extractBranchSuggestion(stdout: string): string {
  const lines = stdout
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of [...lines].reverse()) {
    const unwrapped = line
      .replace(LEADING_LIST_MARKER_PATTERN, "")
      .replace(BRANCH_LABEL_PATTERN, "")
      .replace(SURROUNDING_MARKUP_PATTERN, "")
      .trim()
      .toLowerCase();
    if (
      isValidGitBranchName(unwrapped) &&
      (lines.length === 1 || /[-_/.]/.test(unwrapped))
    ) {
      return normalizeBranchSuggestion(unwrapped);
    }
  }
  return lines.length === 1 ? normalizeBranchSuggestion(lines[0] ?? "") : "";
}

function buildBranchRepairPrompt({
  previousOutput,
  task,
}: {
  previousOutput: string;
  task: string;
}): string {
  return [
    "The previous response was not a valid Git branch name.",
    "Return exactly one corrected branch name and nothing else.",
    "Use 2-5 semantic lowercase English words with ASCII letters and digits.",
    "Only . _ / - separators are allowed. Do not use spaces, .., @{, a leading dash, a dot-prefixed path segment, or a .lock suffix.",
    `Task: ${task}`,
    `Previous response: ${previousOutput.replaceAll("\0", "").slice(0, 1000)}`,
  ].join("\n");
}

/** custom 模式同步派生;ai 模式先调通用 AI 文本生成,再由 Git 插件规整/去重。 */
export async function resolveSubmitDraft({
  branchNamePromptTemplate,
  data,
  generateText,
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
  const generation = await generateText({
    prompt: buildBranchNamePrompt({
      projectRootPath: data.mainPath,
      template: branchNamePromptTemplate,
      text: values.text.trim(),
    }),
    projectRootPath: data.mainPath,
  });
  if (generation.status !== "ok") {
    return {
      error: text(
        `generateFailed.${generation.reason}`,
        { message: generation.message },
        "Agent invocation failed: {{message}}"
      ),
    };
  }
  let generatedCandidate = extractBranchSuggestion(generation.text);
  if (!generatedCandidate) {
    const repair = await generateText({
      projectRootPath: data.mainPath,
      prompt: buildBranchRepairPrompt({
        previousOutput: generation.text,
        task: values.text.trim(),
      }),
    });
    if (repair.status !== "ok") {
      return {
        error: text(
          `generateFailed.${repair.reason}`,
          { message: repair.message },
          "Agent invocation failed: {{message}}"
        ),
      };
    }
    generatedCandidate = extractBranchSuggestion(repair.text);
  }
  const draft = deriveWorktreeCreationFromSlug(generatedCandidate, shared);
  if (!draft) {
    return {
      error: text(
        "generateFailed.invalid_response",
        undefined,
        "AI could not generate a valid branch name, try again"
      ),
    };
  }
  return { draft };
}

export function readBranchNamePromptTemplate(
  configuration: RendererPluginContext["configuration"]
): string {
  const value = configuration.get<unknown>(
    GIT_WORKTREE_BRANCH_NAME_PROMPT_SETTING_KEY
  );
  return typeof value === "string" ? value : "";
}

export function AiFieldDescription({
  rootPath,
  text,
}: {
  rootPath: string;
  text: TextFn;
}) {
  return (
    <FieldDescription>
      {text(
        "taskHint",
        { root: rootPath },
        "Smart generation uses the task description and current project context to generate a branch name and create an isolated worktree under {{root}}."
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
  if (defaults.copyPatterns.length === 0) {
    return null;
  }
  return (
    <FieldDescription className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">
        {text(
          "prepareCopy",
          { count: defaults.copyPatterns.length },
          "Copy {{count}} ignored file entries"
        )}
      </Badge>
    </FieldDescription>
  );
}
