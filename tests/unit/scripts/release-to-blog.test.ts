import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, ".github/scripts/release-to-blog.py");
const APP_WORKFLOW = join(ROOT, ".github/workflows/release-app.yml");
const BLOG_WORKFLOW = join(ROOT, ".github/workflows/release-to-blog.yml");

const CHANGELOG = `# CHANGELOG

## [Unreleased]

- **不该出现。** 未发布条目。

## [0.1.33] - 2026-08-28

### Added

- **项目记忆。** 设置里可为仓库登记配置。
- **同网移动端接入。** 设置里可配对手机。

### Changed

- **Markdown 舒适阅读栏。** 版心改为根字号 \`42rem\`。

### Removed

- **工作台面板。** 去掉新建工作台命令。

### Fixed

- **Git Review 搜索栏 Esc。** 打开文件后仍能关掉搜索。

## [0.1.32] - 2026-08-26

### Changed

- **旧版本条目。** 不应进入 0.1.33 文章。
`;

const tempDirs: string[] = [];

function runGenerator(args: string[]): {
  outDir: string;
  status: number;
  stderr: string;
  stdout: string;
} {
  const outDir = mkdtempSync(join(tmpdir(), "pier-blog-"));
  tempDirs.push(outDir);
  const changelog = join(outDir, "CHANGELOG.md");
  writeFileSync(changelog, CHANGELOG);
  try {
    const stdout = execFileSync(
      "python3",
      [
        SCRIPT,
        "--changelog",
        changelog,
        "--out",
        join(outDir, "posts"),
        ...args,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TRANSLATE_LANGS: "" },
      }
    );
    return { outDir, status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      outDir,
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("release-to-blog generator", () => {
  it("writes zh frontmatter, Chinese section headings, and a versioned title", () => {
    const { outDir, status, stdout } = runGenerator(["--version", "v0.1.33"]);
    expect(status).toBe(0);
    expect(stdout).toContain("pier-0-1-33.md");
    expect(readFileSync(join(outDir, "posts", "slug"), "utf8")).toBe(
      "pier-0-1-33"
    );
    const zh = readFileSync(
      join(outDir, "posts", "zh", "pier-0-1-33.md"),
      "utf8"
    );
    expect(zh).toContain('title: "Pier 0.1.33：项目记忆"');
    expect(zh).toContain("pubDate: 2026-08-28");
    expect(zh).toContain("lang: zh");
    expect(zh).toContain("## 新增");
    expect(zh).toContain("## 变更");
    expect(zh).toContain("## 移除");
    expect(zh).toContain("## 修复");
    expect(zh).toContain("**项目记忆。**");
    expect(zh).not.toContain("## Added");
    expect(zh).not.toContain("旧版本条目");
    expect(zh).not.toContain("不该出现");
    expect(zh).not.toContain("Unreleased");
  });

  it("skips missing changelog entries without writing a slug", () => {
    const { outDir, status, stdout } = runGenerator(["--version", "v9.9.9"]);
    expect(status).toBe(0);
    expect(stdout).toContain("[skip]");
    expect(() => readFileSync(join(outDir, "posts", "slug"), "utf8")).toThrow();
  });
});

describe("release-to-blog workflow", () => {
  it("is called by Release App after Latest is verified, not by on.release", () => {
    const app = readFileSync(APP_WORKFLOW, "utf8");
    const blog = readFileSync(BLOG_WORKFLOW, "utf8");
    expect(app).toContain("uses: ./.github/workflows/release-to-blog.yml");
    expect(app).toContain("needs: release");
    expect(app).toContain("secrets: inherit");
    expect(app).toContain("GITHUB_TOKEN");
    expect(blog).toContain("workflow_call");
    expect(blog).toContain("workflow_dispatch");
    expect(blog).toContain("GITHUB_TOKEN");
    expect(blog).not.toContain("types: [published]");
    expect(blog).not.toContain("github.event.release.tag_name");
    expect(blog).toContain("git push origin HEAD:main");
    expect(blog).toContain("runloom/pier-website");
    expect(blog).not.toContain("gh pr create");
    expect(blog).toContain("BLOG_PAT");
    expect(blog).toContain(".github/scripts/release-to-blog.py");
  });
});
