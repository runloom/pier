import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Changes 面板边界：审查 + 单文件整理；不提供侧栏提交表单 / Stage All 工具条。
 * 已取消：docs/superpowers/specs/2026-07-22-git-commit-mainline-design.md
 * 继任确认卡（不是 footer）：docs/superpowers/specs/2026-08-29-git-commit-confirm-design.md
 * 允许 `renderer/commit/`；禁止 renderer 根上的 `git-commit-form.tsx`。
 */
const gitRendererDir = join(process.cwd(), "src/plugins/builtin/git/renderer");
const gitLocalesDir = join(process.cwd(), "src/plugins/builtin/git/locales");

function source(relativePath: string): string {
  return readFileSync(join(gitRendererDir, relativePath), "utf8");
}

function locale(file: string): string {
  return readFileSync(join(gitLocalesDir, file), "utf8");
}

describe("Git Changes panel product boundary governance", () => {
  it("does not ship sidebar commit form or stage-all toolbar modules", () => {
    const removed = [
      "git-commit-form.tsx",
      "git-commit-composer.tsx",
      "git-commit-composer-model.ts",
      "git-review-tree-toolbar.tsx",
      "git-stage-all.ts",
    ];
    for (const file of removed) {
      expect(existsSync(join(gitRendererDir, file)), file).toBe(false);
    }
  });

  it("does not mount commit form or stage-all toolbar on the changes panel", () => {
    const panel = source("changes-panel.tsx");
    expect(panel).not.toMatch(/GitCommitForm|git-commit-form/);
    expect(panel).not.toMatch(/GitReviewTreeToolbar|git-review-tree-toolbar/);
    expect(panel).not.toMatch(/git-stage-all|stageAllFromEntries/);
    expect(panel).not.toMatch(/sidebarFooter|sidebarHeader/);
  });

  it("does not keep commit-form / stage-all product copy in git locales", () => {
    for (const file of ["en.json", "zh-CN.json"] as const) {
      const text = locale(file);
      expect(text, file).not.toMatch(/"ui\.commitButton"/);
      expect(text, file).not.toMatch(/"ui\.commitMessage/);
      expect(text, file).not.toMatch(/"ui\.commitSuccess"/);
      expect(text, file).not.toMatch(/"ui\.commitFailed"/);
      expect(text, file).not.toMatch(/"ui\.stageAll"/);
      expect(text, file).not.toMatch(/"ui\.unstageAll"/);
    }
  });

  it("keeps commit-mainline design/plan marked cancelled to block revival", () => {
    const spec = readFileSync(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-07-22-git-commit-mainline-design.md"
      ),
      "utf8"
    );
    const plan = readFileSync(
      join(
        process.cwd(),
        "docs/superpowers/plans/2026-07-22-git-commit-mainline.md"
      ),
      "utf8"
    );
    expect(spec).toMatch(/已取消|CANCELLED|cancelled/i);
    expect(plan).toMatch(/已取消|CANCELLED|cancelled/i);
    expect(spec).toMatch(/禁止/);
    expect(plan).toMatch(/不要执行|禁止|作废/);
    expect(spec).toMatch(/2026-08-29-git-commit-confirm-design/);
  });

  it("ships the confirm-card commit module under renderer/commit, not a panel footer", () => {
    const overlay = source("commit/overlay.tsx");
    expect(existsSync(join(gitRendererDir, "commit/overlay.tsx"))).toBe(true);
    expect(existsSync(join(gitRendererDir, "commit/action.ts"))).toBe(true);
    expect(overlay).toContain("openGitCommitOverlay");
    expect(overlay).not.toMatch(/sidebarFooter/);
    expect(source("commit/submit.ts")).not.toMatch(/add\s+-A\b/);
    expect(source("commit/submit.ts")).toContain("getStatus");
    const successor = readFileSync(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-08-29-git-commit-confirm-design.md"
      ),
      "utf8"
    );
    expect(successor).toMatch(/确认卡/);
    expect(successor).toMatch(/sidebarFooter/);
  });
});
