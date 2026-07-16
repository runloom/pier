import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SETTINGS_COMPONENTS = join(
  ROOT,
  "src",
  "renderer",
  "pages",
  "settings",
  "components"
);
const SOURCE_FILE_RE = /\.(ts|tsx)$/;

function _sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(..._sourceFiles(filePath));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath);
}

/**
 * 取出 `export function XxxSection` 的顶层 return JSX 文本（括号匹配）。
 * 仅用于治理扫描，不要求完整 TSX 解析。
 */
function extractExportedSectionReturn(source: string): string | null {
  const start = source.search(/export function \w+Section\b/);
  if (start < 0) {
    return null;
  }
  const returnIdx = source.indexOf("return (", start);
  if (returnIdx < 0) {
    return null;
  }
  const openParen = returnIdx + "return ".length;
  if (source[openParen] !== "(") {
    return null;
  }
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openParen + 1, i);
      }
    }
  }
  return null;
}

/**
 * 在 Section return JSX 中，若出现 <Alert 且当前不在 <Card …> 深度内 → 违规。
 * 用简易标签深度：遇到 <Card / <Card> / <Card ...> 加深，</Card> 减浅。
 */
function findBareAlertInSectionReturn(jsx: string): boolean {
  let cardDepth = 0;
  const tokenRe = /<\/?Card\b[^>]*>|<Alert\b/g;
  let match = tokenRe.exec(jsx);
  while (match) {
    const token = match[0];
    if (token.startsWith("</Card")) {
      cardDepth = Math.max(0, cardDepth - 1);
    } else if (token.startsWith("<Card")) {
      if (!token.endsWith("/>")) {
        cardDepth += 1;
      }
    } else if (token.startsWith("<Alert") && cardDepth === 0) {
      return true;
    }
    match = tokenRe.exec(jsx);
  }
  return false;
}

describe("settings section Alert layout governance", () => {
  it("documents the settings Alert-in-Card policy in AGENTS.md", () => {
    const agentContext = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agentContext).toContain("### 设置页状态提示布局");
    expect(agentContext).toContain("必须放在 `Card` / `CardContent` 内");
    expect(agentContext).toContain(
      "tests/unit/renderer/settings-section-alert-layout-governance.test.ts"
    );
  });

  it("keeps top-level settings section return Alerts inside Card", () => {
    // 仅检查设置对话框直接挂载的 section，不扫嵌套子块（如 managed-plugins-section
    // 本身渲染在父 Card 内，文件顶层 return 会误报）。
    const settingsDialog = readFileSync(
      join(ROOT, "src", "renderer", "pages", "settings", "settings-dialog.tsx"),
      "utf8"
    );
    const mountedSectionFiles = [
      ...settingsDialog.matchAll(
        /from "@\/pages\/settings\/components\/([A-Za-z0-9_-]+\.tsx)"/g
      ),
    ].map((match) => join(SETTINGS_COMPONENTS, match[1] ?? ""));

    const offenders = mountedSectionFiles.flatMap((filePath) => {
      if (!filePath.endsWith("-section.tsx")) {
        return [];
      }
      const source = readFileSync(filePath, "utf8");
      const sectionReturn = extractExportedSectionReturn(source);
      if (!sectionReturn) {
        return [];
      }
      if (!findBareAlertInSectionReturn(sectionReturn)) {
        return [];
      }
      return [projectRelative(filePath)];
    });

    expect(offenders).toEqual([]);
  });
});
