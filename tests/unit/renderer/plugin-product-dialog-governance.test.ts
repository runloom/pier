import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const PLUGIN_RENDERER_ROOTS = [
  join(ROOT, "packages", "plugin-codex", "src", "renderer"),
  join(ROOT, "packages", "plugin-grok", "src", "renderer"),
];
const FORBIDDEN_IMPORT_RE =
  /from\s+["']@pier\/ui\/(?:dialog|alert-dialog)(?:\.tsx)?["']/;

function walkSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) files.push(full);
  }
  return files;
}

describe("plugin product dialog governance", () => {
  it("forbids product Dialog / AlertDialog imports in plugin renderer sources", () => {
    const offenders: string[] = [];
    for (const root of PLUGIN_RENDERER_ROOTS) {
      for (const file of walkSourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        if (FORBIDDEN_IMPORT_RE.test(source)) {
          offenders.push(relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("documents host content dialog rules in AGENTS.md", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain("宿主弹窗使用规范");
    expect(agents).toMatch(/content dialog|内容弹窗|AppContentDialogHost/i);
    expect(agents).toMatch(/dialogs\.open|context\.dialogs\.open/);
    expect(agents).toMatch(
      /plugins must not mount|插件.*不得.*@pier\/ui\/dialog|禁止.*插件.*Dialog/i
    );
  });
});
