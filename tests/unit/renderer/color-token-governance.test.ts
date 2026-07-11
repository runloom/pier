import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(css|ts|tsx)$/;
const RAW_COLOR_RE =
  /(?<![\w])#(?:[\da-fA-F]{8}|[\da-fA-F]{6}|[\da-fA-F]{4}|[\da-fA-F]{3})(?![\da-fA-F\w])|\b(?:hsl|hsla|oklab|oklch|rgb|rgba)\(/;
const FIXED_TAILWIND_COLOR_RE =
  /\b(?:bg|border|fill|ring|stroke|text)-(?:black|white|(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3})\b/;
const FIXED_TAILWIND_COLOR_VAR_RE =
  /--color-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3}\b/;
const SKIPPED_DIRECTORIES = new Set(["build", "dist", "node_modules", "out"]);
const RAW_COLOR_OWNERS = new Set([
  "packages/ui/src/chart.tsx",
  "src/renderer/app/globals.css",
  "src/renderer/components/agent-icons/glyphs.tsx",
  "src/shared/theme-colors.ts",
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        files.push(...sourceFiles(filePath));
      }
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split(sep).join("/");
}

function isRawColorOwner(filePath: string): boolean {
  const relativePath = projectRelative(filePath);
  return (
    RAW_COLOR_OWNERS.has(relativePath) ||
    relativePath.startsWith("src/renderer/lib/theme/")
  );
}

describe("color token governance", () => {
  const files = [join(ROOT, "src"), join(ROOT, "packages")].flatMap(
    sourceFiles
  );

  it("documents one-way color ownership in the project context", () => {
    const context = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

    expect(context).toContain("### 颜色使用规范");
    expect(context).toContain("主题原色 → 语义令牌 → 组件变体 → 业务映射");
  });

  it("keeps raw colors inside explicit palette, theme, native, or brand owners", () => {
    const offenders = files
      .filter((filePath) => !isRawColorOwner(filePath))
      .filter((filePath) => RAW_COLOR_RE.test(readFileSync(filePath, "utf8")))
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("forbids fixed Tailwind palette classes and variables in production source", () => {
    const offenders = files
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return (
          FIXED_TAILWIND_COLOR_RE.test(source) ||
          FIXED_TAILWIND_COLOR_VAR_RE.test(source)
        );
      })
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("keeps neutral actions independent from semantic state colors", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const button = readFileSync(
      join(ROOT, "packages/ui/src/button.tsx"),
      "utf8"
    );

    expect(globals).not.toContain("--action-accent:");
    expect(globals).not.toContain("--action-danger:");
    expect(globals).toContain("--action-muted: var(--muted-foreground)");
    expect(button).not.toContain("text-action-accent");
    expect(button).not.toContain("text-action-danger");
    expect(button).not.toContain("text-status-info-fg");
  });
});
