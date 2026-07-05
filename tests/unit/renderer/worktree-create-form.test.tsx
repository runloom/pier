import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  AiFieldDescription,
  buildBranchNamePrompt,
  extractAnswerLine,
  type FormValues,
  HEAD_SENTINEL,
  normalizeBranchSuggestion,
  resolveSubmitDraft,
  type TextFn,
  type WorktreeCreateOverlayData,
} from "@plugins/builtin/git/renderer/worktree-create-form.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const PREFIX_COPY = /with prefix|prefix feature\//;
const TRAILING_BRANCH_SEPARATOR_PATTERN = /[-./]$/;

const text: TextFn = (_key, values, fallback) =>
  Object.entries(values ?? {}).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, String(value)),
    fallback
  );

const DATA: WorktreeCreateOverlayData = {
  branches: [
    {
      isCurrent: true,
      kind: "local",
      lastCommit: "abc123",
      name: "main",
      upstream: null,
    },
  ],
  defaults: {
    copyPatterns: [],
    rootPath: "/repo.worktree",
    setupCommand: "",
  },
  existingBranches: ["main"],
  existingNames: [],
  mainPath: "/repo",
};

function formValues(overrides: Partial<FormValues> = {}): FormValues {
  return {
    base: HEAD_SENTINEL,
    branch: "",
    mode: "ai",
    text: "修复终端焦点问题",
    ...overrides,
  };
}

describe("buildBranchNamePrompt", () => {
  it("空模板使用 fallback 并替换任务描述", () => {
    const prompt = buildBranchNamePrompt({
      projectRootPath: "/repo",
      template: "",
      text: "修复弹窗 UI",
    });
    expect(prompt).toContain("Turn this software task description");
    expect(prompt).toContain("Task: 修复弹窗 UI");
    expect(prompt).not.toContain("{{task}}");
  });

  it("自定义模板替换 task/projectRootPath;缺 task 占位符时自动追加任务", () => {
    expect(
      buildBranchNamePrompt({
        projectRootPath: "/repo",
        template: "Repo={{projectRootPath}}\nName for {{task}}",
        text: "修复焦点",
      })
    ).toBe("Repo=/repo\nName for 修复焦点");
    expect(
      buildBranchNamePrompt({
        projectRootPath: "/repo",
        template: "Only output feature/*",
        text: "修复焦点",
      })
    ).toBe("Only output feature/*\n\nTask: 修复焦点");
  });
});

describe("extractAnswerLine", () => {
  it("取最后一个非空行并剥离 ANSI 转义", () => {
    expect(
      extractAnswerLine("banner line\nthinking...\n\nfix-dialog-ui\n\n")
    ).toBe("fix-dialog-ui");
    expect(extractAnswerLine("\u001b[32mfix-x\u001b[0m\n")).toBe("fix-x");
    expect(extractAnswerLine("")).toBe("");
  });
});

describe("normalizeBranchSuggestion", () => {
  it("小写化、空白与非法字符折叠为连字符、保留分支路径前缀", () => {
    expect(normalizeBranchSuggestion("Fix Dialog UI")).toBe("fix-dialog-ui");
    expect(normalizeBranchSuggestion("  `fix-login`.  ")).toBe("fix-login");
    expect(normalizeBranchSuggestion("feature/fix dialog")).toBe(
      "feature/fix-dialog"
    );
    expect(normalizeBranchSuggestion("fix_login/flow")).toBe("fix_login/flow");
  });

  it("超长分支候选会截断且不以分隔符结尾", () => {
    const branch = normalizeBranchSuggestion(
      "feature/implement-comprehensive-workspace-layout-manager-for-dockview-panels-and-terminal-focus"
    );
    expect(branch.length).toBeLessThanOrEqual(64);
    expect(branch).not.toMatch(TRAILING_BRANCH_SEPARATOR_PATTERN);
  });

  it("全非法内容返回空串", () => {
    expect(normalizeBranchSuggestion("！！！")).toBe("");
    expect(normalizeBranchSuggestion("")).toBe("");
  });
});

describe("resolveSubmitDraft", () => {
  it("AI 模式调用通用 generateText,再由 Git 插件解析分支名", async () => {
    const generateText = vi
      .fn<RendererPluginContext["ai"]["generateText"]>()
      .mockResolvedValue({
        status: "ok",
        text: "thinking\nfeature/fix-focus\n",
      });

    const result = await resolveSubmitDraft({
      branchNamePromptTemplate: "Use feature/* for {{task}}",
      data: DATA,
      generateText,
      text,
      values: formValues({ text: "修复焦点" }),
    });

    expect(result).toEqual({
      draft: {
        branch: "feature/fix-focus",
        name: "feature-fix-focus",
        source: "description",
      },
    });
    expect(generateText).toHaveBeenCalledWith({
      projectRootPath: "/repo",
      prompt: "Use feature/* for 修复焦点",
    });
  });

  it("AI 输出无可用分支名时由插件返回 invalid_response 错误", async () => {
    const generateText = vi
      .fn<RendererPluginContext["ai"]["generateText"]>()
      .mockResolvedValue({
        status: "ok",
        text: "！！！\n",
      });

    const result = await resolveSubmitDraft({
      branchNamePromptTemplate: "",
      data: DATA,
      generateText,
      text,
      values: formValues(),
    });

    expect(result).toEqual({
      error: "AI returned no usable branch name, try again",
    });
  });
});

describe("AiFieldDescription", () => {
  it("does not mention branch prefixes in the smart generation hint", () => {
    render(
      <AiFieldDescription
        agentLabel="Claude"
        aiConfigured={true}
        rootPath="/repo.worktree"
        statusLoading={false}
        text={text}
      />
    );

    expect(
      screen.getByText(
        "Default agent (Claude) will generate a branch name from the task description and create an isolated worktree under /repo.worktree."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(PREFIX_COPY)).not.toBeInTheDocument();
  });
});
