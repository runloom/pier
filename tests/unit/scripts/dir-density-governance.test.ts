import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Domain folders where the parent directory already carries the prefix —
 * basenames must not restate that prefix.
 */
const NO_PARENT_PREFIX_DIRS: { dir: string; bannedPrefix: string }[] = [
  { dir: "src/main/services/git", bannedPrefix: "git-" },
  { dir: "src/main/services/files", bannedPrefix: "file-" },
  { dir: "src/main/ipc/terminal", bannedPrefix: "terminal-" },
  { dir: "src/main/services/git/watch", bannedPrefix: "watch-" },
  { dir: "src/main/services/git/worktree", bannedPrefix: "worktree-" },
  { dir: "src/main/services/git-review/index", bannedPrefix: "git-review-" },
  { dir: "src/main/services/git-review/document", bannedPrefix: "git-review-" },
  { dir: "src/main/services/project-skills/apply", bannedPrefix: "apply-" },
  { dir: "src/main/services/project-skills/repair", bannedPrefix: "repair-" },
  { dir: "src/main/services/project-skills/import", bannedPrefix: "import-" },
  { dir: "src/main/app-core", bannedPrefix: "app-core-" },
  { dir: "src/main/services/file-query", bannedPrefix: "file-query-" },
  {
    dir: "src/plugins/builtin/git/renderer/review",
    bannedPrefix: "git-review-",
  },
  {
    dir: "src/plugins/builtin/git/renderer/review/document",
    bannedPrefix: "document-",
  },
  // files plugin package path already says "files" — basenames must not restate it
  { dir: "src/plugins/builtin/files/renderer", bannedPrefix: "files-" },
  { dir: "src/plugins/builtin/files/renderer", bannedPrefix: "file-" },
  {
    dir: "src/plugins/builtin/files/renderer/editor",
    bannedPrefix: "file-editor-",
  },
  {
    dir: "src/plugins/builtin/files/renderer/tree",
    bannedPrefix: "file-tree-",
  },
  {
    dir: "src/plugins/builtin/files/renderer/markdown",
    bannedPrefix: "markdown-",
  },
  {
    dir: "src/plugins/builtin/files/renderer/lsp",
    bannedPrefix: "lsp-",
  },
  {
    dir: "src/plugins/builtin/files/renderer/panel",
    bannedPrefix: "panel-",
  },

  { dir: "src/main/services/tasks", bannedPrefix: "task-" },
  { dir: "src/main/services/agents", bannedPrefix: "agent-" },
  { dir: "src/main/services/agent-attention", bannedPrefix: "attention-" },
  { dir: "src/main/plugins", bannedPrefix: "plugin-" },
  { dir: "src/main/windows", bannedPrefix: "window-" },
  { dir: "src/main/app-quit", bannedPrefix: "quit-" },
  { dir: "src/main/files", bannedPrefix: "file-" },
  { dir: "src/plugins/builtin/git/renderer", bannedPrefix: "git-" },
  { dir: "src/renderer/lib/plugins", bannedPrefix: "plugin-" },
  { dir: "src/plugins/builtin/files/renderer/search", bannedPrefix: "search-" },
  {
    dir: "src/plugins/builtin/files/renderer/preview",
    bannedPrefix: "preview-",
  },

  { dir: "src/main/sounds", bannedPrefix: "sound-" },
  { dir: "src/renderer/lib/notifications", bannedPrefix: "notification-" },
  {
    dir: "src/renderer/pages/settings/components/skills",
    bannedPrefix: "skill-",
  },
  {
    dir: "src/renderer/pages/settings/components/skills",
    bannedPrefix: "skills-",
  },
  {
    dir: "src/renderer/lib/command-palette",
    bannedPrefix: "use-command-palette-",
  },
  { dir: "src/renderer/lib/context-menu", bannedPrefix: "use-context-menu" },
  { dir: "src/renderer/lib/keybindings", bannedPrefix: "use-keybindings" },
  { dir: "src/renderer/lib/attention", bannedPrefix: "play-attention-" },
  {
    dir: "packages/plugin-api/src/account-usage",
    bannedPrefix: "refresh-account-",
  },
  { dir: "src/renderer/lib/search", bannedPrefix: "action-search" },
  { dir: "src/shared/source-editor", bannedPrefix: "editor-" },
  { dir: "src/main/services/project-skills", bannedPrefix: "skill-" },
  { dir: "packages/ui/src/diff-view", bannedPrefix: "diff-view-" },
  { dir: "packages/ui/src/file", bannedPrefix: "file-" },
  { dir: "src/renderer/lib/plugins/host", bannedPrefix: "host-" },
  { dir: "src/renderer/lib/plugins/external", bannedPrefix: "external-" },
  { dir: "src/renderer/lib/plugins/mermaid", bannedPrefix: "mermaid-" },
  {
    dir: "src/renderer/panel-kits/terminal/structured-composer",
    bannedPrefix: "structured-composer-",
  },
  { dir: "src/shared/contracts/terminal", bannedPrefix: "terminal-" },
  { dir: "src/shared/contracts/agent", bannedPrefix: "agent-" },
  { dir: "src/main/app-core/commands", bannedPrefix: "" }, // special: no -commands suffix
];

describe("directory density governance", () => {
  it("wires check:dir-density into package scripts and check:static", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:dir-density"]).toContain("check-dir-density.mjs");
    expect(pkg.scripts["check:static"]).toContain("check:dir-density");
  });

  it("keeps density config and checker", () => {
    expect(existsSync(join(ROOT, ".pier/dir-density.json"))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/check-dir-density.mjs"))).toBe(true);
    const config = JSON.parse(read(".pier/dir-density.json")) as {
      maxDirectSourceFiles: number;
      skipDirPatterns: string[];
      allowlist: Record<string, { max: number; reason: string }>;
    };
    expect(config.maxDirectSourceFiles).toBeGreaterThanOrEqual(10);
    expect(config.skipDirPatterns.length).toBeGreaterThan(0);
    for (const [path, entry] of Object.entries(config.allowlist)) {
      expect(entry.max, path).toBeGreaterThan(config.maxDirectSourceFiles);
      expect(entry.reason.length, path).toBeGreaterThan(0);
    }
  });

  it("documents density + non-redundant naming in AGENTS.md", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("目录密度与命名");
    expect(agents).toContain("check:dir-density");
    expect(agents).toContain("文件名不得再重复父目录语义");
    expect(agents).toContain("dir-density-governance.test.ts");
  });

  it("forbids parent-directory prefixes restated in basenames under domain folders", () => {
    const violations: string[] = [];

    for (const { dir, bannedPrefix } of NO_PARENT_PREFIX_DIRS) {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) {
        continue;
      }
      for (const name of readdirSync(abs)) {
        const filePath = join(abs, name);
        if (!statSync(filePath).isFile()) {
          continue;
        }
        if (
          !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ||
          name.endsWith(".d.ts")
        ) {
          continue;
        }
        if (bannedPrefix && name.startsWith(bannedPrefix)) {
          violations.push(`${dir}/${name} (banned prefix ${bannedPrefix})`);
        }
        if (dir.endsWith("/commands") && name.endsWith("-commands.ts")) {
          violations.push(`${dir}/${name} (redundant -commands suffix)`);
        }
        // foo/foo.ts (but index/index.ts is the correct entry idiom)
        const parent = dir.split("/").pop() ?? "";
        if (
          parent !== "index" &&
          (name === `${parent}.ts` || name === `${parent}.tsx`)
        ) {
          violations.push(
            `${dir}/${name} (use index.ts instead of ${parent}/${parent}.*)`
          );
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("passes the live density gate", () => {
    // Shell gate also runs in check:static; keep a unit-level lock so regressions
    // surface in test:unit without waiting for the full static pipeline.
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-dir-density.mjs"], {
        cwd: ROOT,
        stdio: "pipe",
        encoding: "utf8",
      })
    ).not.toThrow();
  });
});
