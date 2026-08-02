import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../../../");
const CONTRACT_DOC = join(
  REPO_ROOT,
  "docs/superpowers/specs/2026-08-02-git-review-live-update-failure-contract-design.md"
);
const FEEDBACK_SRC = join(
  REPO_ROOT,
  "src/plugins/builtin/git/renderer/review/feedback.tsx"
);

describe("Git Review live-update failure governance", () => {
  it("契约文档锁定背景路径零 toast 与 K1/K6/K7", () => {
    const doc = readFileSync(CONTRACT_DOC, "utf8");
    expect(doc).toContain("Git Review：持续更新与失败面契约");
    expect(doc).toContain("背景路径全局 error toast 配额 = 0");
    expect(doc).toContain("**K1**");
    expect(doc).toContain("**K6**");
    expect(doc).toContain("**K7**");
    expect(doc).toContain("产品已确认");
  });

  it("ReviewFeedback 背景路径不得调用通知 API", () => {
    const source = readFileSync(FEEDBACK_SRC, "utf8");
    expect(source).toContain("2026-08-02");
    expect(source).toContain("不得抬升全局");
    // 实现调用点（排除注释）：不得出现通知门面调用
    const codeOnly = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !(
          trimmed.startsWith("*") ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("*/")
        );
      })
      .join("\n");
    expect(codeOnly).not.toMatch(/notifications\.(?:error|info|success)/u);
    expect(codeOnly).not.toMatch(/context\.notifications/u);
  });
});
