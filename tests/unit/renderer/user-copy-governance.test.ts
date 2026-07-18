import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const LOCALE_ROOTS = [
  join(ROOT, "src", "renderer", "i18n", "locales", "zh-CN"),
  join(ROOT, "src", "renderer", "i18n", "locales", "en"),
  join(ROOT, "src", "plugins", "builtin", "files", "locales"),
  join(ROOT, "src", "plugins", "builtin", "git", "locales"),
] as const;

/** 中文用户串禁用实现词 / 中英混用。只扫字符串值，不扫 key。 */
const ZH_BANNED_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "选区", pattern: /选区/ },
  { id: "上下文", pattern: /上下文/ },
  { id: "耐久性", pattern: /耐久性/ },
  { id: "运行态", pattern: /运行态/ },
  { id: "renderer", pattern: /renderer/i },
  { id: "面板参数", pattern: /面板参数/ },
  { id: "可绑定", pattern: /可绑定/ },
  { id: "运行标识", pattern: /运行标识/ },
  { id: "物料", pattern: /物料/ },
  { id: "仅清单预览", pattern: /仅清单预览/ },
  { id: "CLI agent", pattern: /CLI\s*agent/i },
  { id: "新建 agent", pattern: /新建\s*agent/i },
  { id: "无 upstream", pattern: /无\s*upstream/i },
  { id: "Git worktree", pattern: /Git\s*worktree/i },
  { id: "DETACHED", pattern: /\bDETACHED\b/ },
  { id: "MERGING", pattern: /\bMERGING\b/ },
  { id: "REBASING", pattern: /\bREBASING\b/ },
  { id: "CHERRY-PICK", pattern: /\bCHERRY-PICK\b/ },
  { id: "REVERTING", pattern: /\bREVERTING\b/ },
  { id: "BISECT 全大写状态码", pattern: /\bBISECT\b/ },
  { id: "Needs you", pattern: /\bNeeds you\b/ },
  { id: "Agent 状态", pattern: /\bAgent\s*状态/ },
  { id: "启动的 CLI", pattern: /启动的\s*CLI/ },
  { id: "已保护(旧草稿态)", pattern: /(?<!草稿)已保护|保护中|未保护|草稿保护/ },
];

/** 英文用户串禁用实现词（与近期白话化保持同步）。 */
const EN_BANNED_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "No project context", pattern: /No project context/i },
  { id: "durability unknown", pattern: /durability unknown/i },
  { id: "before durability", pattern: /before durability/i },
  { id: "protected drafts", pattern: /protected drafts/i },
  { id: "Draft protection failed", pattern: /Draft protection failed/i },
  { id: "Confirm write", pattern: /\bConfirm write\b/ },
  { id: "Manifest preview", pattern: /Manifest preview/i },
  { id: "run identity", pattern: /run identity/i },
  { id: "renderer component", pattern: /renderer component/i },
  { id: "panel parameters", pattern: /panel parameters/i },
  { id: "workspace context", pattern: /workspace context/i },
  { id: "project context", pattern: /project context/i },
  { id: "DETACHED", pattern: /\bDETACHED\b/ },
  { id: "MERGING", pattern: /\bMERGING\b/ },
  { id: "REBASING", pattern: /\bREBASING\b/ },
  { id: "CHERRY-PICK", pattern: /\bCHERRY-PICK\b/ },
  { id: "REVERTING", pattern: /\bREVERTING\b/ },
  { id: "BISECT 全大写状态码", pattern: /\bBISECT\b/ },
];

/**
 * 允许的例外：路径占位、代码标识等。
 * 值匹配任一正则则跳过该字符串的禁词检查。
 */
const VALUE_ALLOWLIST: readonly RegExp[] = [
  /\.worktree\b/,
  /\{[^}]*worktree[^}]*\}/i,
  /PIER_PLUGIN_MODE/,
  /pnpm dev/,
];

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split(sep).join("/");
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...listFiles(filePath));
      continue;
    }
    if (/\.(ts|json)$/.test(entry) && entry !== "types.ts") {
      files.push(filePath);
    }
  }
  return files;
}

function isChineseLocalePath(filePath: string): boolean {
  const relativePath = projectRelative(filePath);
  return (
    relativePath.includes("/zh-CN/") ||
    relativePath.endsWith("/zh-CN.json") ||
    relativePath.endsWith("zh-CN.json")
  );
}

function isEnglishLocalePath(filePath: string): boolean {
  const relativePath = projectRelative(filePath);
  return (
    relativePath.includes("/en/") ||
    relativePath.endsWith("/en.json") ||
    relativePath.endsWith("en.json")
  );
}

function extractJsonStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractJsonStringValues(item, out);
    }
    return out;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      extractJsonStringValues(child, out);
    }
  }
  return out;
}

/** 宿主 locale TS 使用 unquoted keys + double-quoted values；只取字面量，避免命中 key。 */
function extractTsStringLiterals(source: string): string[] {
  const values: string[] = [];
  const re = /(?<!\\)"((?:\\.|[^"\\])*)"/g;
  for (const match of source.matchAll(re)) {
    const raw = match[1];
    if (raw === undefined) {
      continue;
    }
    if (raw.startsWith("./") || raw.startsWith("../") || raw.endsWith(".ts")) {
      continue;
    }
    values.push(raw.replace(/\\"/g, '"').replace(/\\n/g, "\n"));
  }
  return values;
}

function extractLocaleValues(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    return extractJsonStringValues(JSON.parse(source));
  }
  return extractTsStringLiterals(source);
}

function findBannedHits(
  values: readonly string[],
  patterns: ReadonlyArray<{ id: string; pattern: RegExp }>
): string[] {
  const hits: string[] = [];
  for (const value of values) {
    if (VALUE_ALLOWLIST.some((pattern) => pattern.test(value))) {
      continue;
    }
    for (const { id, pattern } of patterns) {
      if (pattern.test(value)) {
        hits.push(`[${id}] ${value}`);
      }
    }
  }
  return hits;
}

describe("user-facing copy governance", () => {
  it("documents the user-facing copy policy in project agent context", () => {
    const agentContext = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

    expect(agentContext).toContain("### 用户可见文案规范");
    expect(agentContext).toContain("说用户动作，不说内部概念");
    expect(agentContext).toContain("失败与空态要带下一步");
    expect(agentContext).toContain(
      "tests/unit/renderer/user-copy-governance.test.ts"
    );
  });

  it("keeps Chinese locale string values free of implementation jargon", () => {
    const offenders = LOCALE_ROOTS.flatMap(listFiles)
      .filter(isChineseLocalePath)
      .flatMap((filePath) => {
        const hits = findBannedHits(
          extractLocaleValues(filePath),
          ZH_BANNED_PATTERNS
        );
        return hits.map((hit) => `${projectRelative(filePath)}: ${hit}`);
      });

    expect(offenders).toEqual([]);
  });

  it("keeps English locale string values free of known jargon regressions", () => {
    const offenders = LOCALE_ROOTS.flatMap(listFiles)
      .filter(isEnglishLocalePath)
      .flatMap((filePath) => {
        const hits = findBannedHits(
          extractLocaleValues(filePath),
          EN_BANNED_PATTERNS
        );
        return hits.map((hit) => `${projectRelative(filePath)}: ${hit}`);
      });

    expect(offenders).toEqual([]);
  });
});
