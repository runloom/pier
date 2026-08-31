import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-08-30-review-open-project-directory-gold-standard.md";
const GIT_DIR = join(ROOT, "src/plugins/builtin/git");
const TOOLBAR = join(
  ROOT,
  "src/plugins/builtin/git/renderer/review/toolbar.tsx"
);
const CHANGES_PANEL = join(
  ROOT,
  "src/plugins/builtin/git/renderer/changes-panel.tsx"
);
const TREE = join(ROOT, "packages/ui/src/file/tree.tsx");
const DISK_OPENED = join(ROOT, "src/plugins/api/files-disk-path-opened.ts");
const OPEN_ACTION = join(
  ROOT,
  "src/plugins/builtin/git/renderer/review/directory/open-action.ts"
);

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (statSync(filePath).isDirectory()) {
      walk(filePath, files);
      continue;
    }
    if (/\.(?:ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(filePath);
    }
  }
  return files;
}

describe("review open-directory gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### 审查打开项目目录");
    expect(agents).toContain(
      "tests/unit/renderer/git/review/open-directory-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("打开目录");
    expect(spec).toContain("FilesDiskPathOpenedEvent");
    expect(spec).toMatch(/禁止/);
    expect(spec).toContain("GitReviewToolbar");
    expect(spec).toContain("5_open");
  });

  it("keeps git from importing files plugin internals", () => {
    for (const file of walk(GIT_DIR)) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/@plugins\/builtin\/files/);
      expect(source).not.toContain('from "../project/open-project.ts"');
    }
  });

  it("keeps open-directory off the command palette, toolbar, and header", () => {
    const action = readFileSync(OPEN_ACTION, "utf8");
    expect(action).toContain("pier.git.review.openDirectory");
    expect(action).toContain("dockview-tab");
    expect(action).not.toContain("command-palette");
    expect(action).toMatch(/group:\s*"5_open"/);
    expect(action).not.toMatch(/group:\s*"1_open"/);
    expect(action).not.toMatch(/group:\s*"6_path"/);
    const toolbar = readFileSync(TOOLBAR, "utf8");
    expect(toolbar).not.toContain("openProjectDirectory");
    expect(toolbar).not.toContain("reviewOpenDirectory");
    expect(toolbar).not.toContain("git-review-open-directory-chip");
    const panel = readFileSync(CHANGES_PANEL, "utf8");
    expect(panel).toContain("GitReviewScopeSwitcher");
    expect(panel.match(/headerLeading=\{scopeSwitcher\}/g)?.length).toBe(4);
    expect(panel).not.toContain("GitReviewHeaderIdentity");
    expect(panel).not.toContain("git-review-open-directory-chip");
    expect(panel).not.toContain("GitReviewProjectDirectoryChip");
    expect(
      existsSync(
        join(ROOT, "src/plugins/builtin/git/renderer/review/directory/chip.tsx")
      )
    ).toBe(false);
    expect(
      existsSync(
        join(
          ROOT,
          "src/plugins/builtin/git/renderer/review/directory/header-leading.tsx"
        )
      )
    ).toBe(false);
  });

  it("does not overload the disk-opened bus", () => {
    const source = readFileSync(DISK_OPENED, "utf8");
    expect(source).not.toContain("intent");
    expect(source).not.toContain("project-directory");
  });

  it("keeps file-tree primary click on files only", () => {
    const source = readFileSync(TREE, "utf8");
    expect(source).toMatch(/kind === "file"/);
  });
});
