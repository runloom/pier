import {
  deriveWorktreeCreation,
  deriveWorktreeCreationFromSlug,
  sanitizeWorktreeName,
  slugifyDescription,
} from "@shared/worktree-naming.ts";
import { describe, expect, it } from "vitest";

const BASE_ARGS = {
  branchPrefix: "wt/",
  existingBranches: [] as readonly string[],
  existingNames: [] as readonly string[],
};

describe("slugifyDescription", () => {
  it("英文描述 → 小写连字符 slug,去停用词,截断到 24 字符", () => {
    expect(slugifyDescription("Fix the terminal focus bug")).toBe(
      "fix-terminal-focus-bug"
    );
    expect(
      slugifyDescription("implement a comprehensive workspace layout manager")
    ).toBe("implement-comprehensive");
  });

  it("CJK 描述提取 ascii token;纯 CJK 返回 null", () => {
    expect(slugifyDescription("修复 terminal focus 丢失")).toBe(
      "terminal-focus"
    );
    expect(slugifyDescription("修复终端焦点丢失")).toBeNull();
  });
});

describe("sanitizeWorktreeName", () => {
  it("斜杠转连字符,剔除非法字符,不产生 . / ..", () => {
    expect(sanitizeWorktreeName("feat/panel drag")).toBe("feat-panel-drag");
    expect(sanitizeWorktreeName("../x")).toBe("x");
  });
});

describe("deriveWorktreeCreation", () => {
  it("任务描述 → wt/ 前缀 slug 分支,name 与分支后缀一致", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "Fix the terminal focus bug",
    });
    expect(draft).toEqual({
      branch: "wt/fix-terminal-focus-bug",
      name: "fix-terminal-focus-bug",
      source: "description",
    });
  });

  it("分支名形态输入原样作为分支,不加前缀", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "feat/panel-drag",
    });
    expect(draft).toEqual({
      branch: "feat/panel-drag",
      name: "feat-panel-drag",
      source: "branch",
    });
  });

  it("命中已有分支 → source 为 existing-branch", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      existingBranches: ["feat/panel-drag"],
      input: "feat/panel-drag",
    });
    expect(draft.source).toBe("existing-branch");
    expect(draft.branch).toBe("feat/panel-drag");
  });

  it("与已有分支/worktree 重名时追加 -2", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      existingBranches: ["wt/fix-focus"],
      existingNames: ["fix-focus"],
      input: "fix focus",
    });
    expect(draft.branch).toBe("wt/fix-focus-2");
    expect(draft.name).toBe("fix-focus-2");
  });

  it("空输入 → 确定性 random 下产出 codename", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "",
      random: () => 0,
    });
    expect(draft.source).toBe("codename");
    expect(draft.branch.startsWith("wt/")).toBe(true);
    expect(draft.name.length).toBeGreaterThan(0);
  });

  it("纯 CJK 描述 → codename 兜底", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "修复终端焦点丢失",
      random: () => 0.5,
    });
    expect(draft.source).toBe("codename");
  });
});

describe("deriveWorktreeCreationFromSlug", () => {
  it("AI slug 套 prefix 并派生目录名", () => {
    const draft = deriveWorktreeCreationFromSlug("fix-dialog-ui", BASE_ARGS);
    expect(draft).not.toBeNull();
    expect(draft?.branch).toBe("wt/fix-dialog-ui");
    expect(draft?.name).toBe("fix-dialog-ui");
    expect(draft?.source).toBe("description");
  });

  it("与已有分支/worktree 重名时追加 -2", () => {
    const draft = deriveWorktreeCreationFromSlug("fix-focus", {
      ...BASE_ARGS,
      existingBranches: ["wt/fix-focus"],
      existingNames: ["fix-focus"],
    });
    expect(draft?.branch).toBe("wt/fix-focus-2");
    expect(draft?.name).toBe("fix-focus-2");
  });

  it("slug 大小写与首尾符号被规整;全非法字符返回 null", () => {
    const draft = deriveWorktreeCreationFromSlug("-Fix-Dialog-", BASE_ARGS);
    expect(draft?.branch).toBe("wt/fix-dialog");
    expect(deriveWorktreeCreationFromSlug("!!!", BASE_ARGS)).toBeNull();
  });
});
