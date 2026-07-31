import {
  deriveWorktreeCreation,
  deriveWorktreeCreationFromSlug,
  isValidGitBranchName,
  sanitizeBranchCandidate,
  sanitizeWorktreeName,
  slugifyDescription,
} from "@shared/worktree-naming.ts";
import { describe, expect, it } from "vitest";

const LEGACY_PREFIX_PATTERN = /^wt\//;

const BASE_ARGS = {
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

describe("Git 分支名规整", () => {
  it("修复连续点和 .lock 后缀", () => {
    expect(sanitizeBranchCandidate("feature/fix..dialog")).toBe(
      "feature/fix-dialog"
    );
    expect(sanitizeBranchCandidate("feature/build.lock")).toBe(
      "feature/build-lock"
    );
  });

  it("对齐 git check-ref-format --branch 的核心非法规则", () => {
    for (const branch of ["feature/fix-dialog", "fix_login", "release/1.2.3"]) {
      expect(isValidGitBranchName(branch)).toBe(true);
    }
    for (const branch of [
      "-feature",
      ".hidden",
      "feature/.hidden",
      "feature/fix..dialog",
      "feature/build.lock",
      "feature//dialog",
      "feature/dialog.",
      "feature/@{dialog",
      "HEAD",
    ]) {
      expect(isValidGitBranchName(branch)).toBe(false);
    }
  });
});

describe("deriveWorktreeCreation", () => {
  it("任务描述 → 未加前缀的 slug 分支,name 与分支一致", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "Fix the terminal focus bug",
    });
    expect(draft).toEqual({
      branch: "fix-terminal-focus-bug",
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

  it("与已有分支/worktree 重名时追加 -2,不在去重前套前缀", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      existingBranches: ["fix-focus"],
      existingNames: ["fix-focus"],
      input: "fix focus",
    });
    expect(draft.branch).toBe("fix-focus-2");
    expect(draft.name).toBe("fix-focus-2");
  });

  it("空输入 → 确定性 random 下产出未加前缀的 codename", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "",
      random: () => 0,
    });
    expect(draft).toEqual({
      branch: "amber-anchor",
      name: "amber-anchor",
      source: "codename",
    });
  });

  it("纯 CJK 描述 → 未加前缀的 codename 兜底", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "修复终端焦点丢失",
      random: () => 0.5,
    });
    expect(draft.source).toBe("codename");
    expect(draft.branch).not.toMatch(LEGACY_PREFIX_PATTERN);
  });
});

describe("deriveWorktreeCreationFromSlug", () => {
  it("AI slug 直接派生未加前缀的 branch/name", () => {
    const draft = deriveWorktreeCreationFromSlug("fix-dialog-ui", BASE_ARGS);
    expect(draft).not.toBeNull();
    expect(draft?.branch).toBe("fix-dialog-ui");
    expect(draft?.name).toBe("fix-dialog-ui");
    expect(draft?.source).toBe("description");
  });

  it("AI 分支候选保留项目规范里的路径前缀,worktree name 仍转换为文件夹安全形式", () => {
    const draft = deriveWorktreeCreationFromSlug(
      "feature/fix-dialog-ui",
      BASE_ARGS
    );
    expect(draft?.branch).toBe("feature/fix-dialog-ui");
    expect(draft?.name).toBe("feature-fix-dialog-ui");
  });

  it("与已有分支/worktree 重名时追加 -2", () => {
    const draft = deriveWorktreeCreationFromSlug("fix-focus", {
      ...BASE_ARGS,
      existingBranches: ["fix-focus"],
      existingNames: ["fix-focus"],
    });
    expect(draft?.branch).toBe("fix-focus-2");
    expect(draft?.name).toBe("fix-focus-2");
  });

  it("slug 大小写与首尾符号被规整;全非法字符返回 null", () => {
    const draft = deriveWorktreeCreationFromSlug("-Fix-Dialog-", BASE_ARGS);
    expect(draft?.branch).toBe("fix-dialog");
    expect(deriveWorktreeCreationFromSlug("!!!", BASE_ARGS)).toBeNull();
  });
});
