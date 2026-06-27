import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en.ts";
import { zhCN } from "@/i18n/locales/zh-cn.ts";
import { ALL_ACTION_CONTRIBUTIONS } from "@/lib/actions/all-action-contributions.ts";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";

const ROOT = process.cwd();
const PRODUCTION_SOURCE_DIR = path.join(ROOT, "src", "renderer");
const PRODUCTION_ACTION_DIRS = [
  path.join(ROOT, "src", "renderer", "lib", "actions"),
  path.join(ROOT, "src", "renderer", "panel-kits"),
];
const ALLOWED_DIRECT_REGISTER_FILES = new Set([
  path.join(
    ROOT,
    "src",
    "renderer",
    "lib",
    "actions",
    "contribution-runtime.ts"
  ),
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const LEGACY_KEYWORDS_RE = /\bkeywords\s*:|metadata\.keywords|LOCALE_KEYWORDS/;

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...sourceFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(fullPath))) {
      result.push(fullPath);
    }
  }
  return result;
}

function relative(filePath: string): string {
  return path.relative(ROOT, filePath);
}

function nestedValue(source: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      source
    );
}

describe("action contribution boundary", () => {
  it("does not use legacy action keywords in production renderer code", () => {
    const offenders = sourceFiles(PRODUCTION_SOURCE_DIR)
      .map((filePath) => ({
        filePath,
        text: readFileSync(filePath, "utf8"),
      }))
      .filter(({ text }) => LEGACY_KEYWORDS_RE.test(text))
      .map(({ filePath }) => relative(filePath));

    expect(offenders).toEqual([]);
  });

  it("keeps production action registration behind contributions", () => {
    const offenders = PRODUCTION_ACTION_DIRS.flatMap(sourceFiles)
      .filter((filePath) => !ALLOWED_DIRECT_REGISTER_FILES.has(filePath))
      .filter((filePath) =>
        readFileSync(filePath, "utf8").includes("actionRegistry.register")
      )
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it("declares every default keymap command as an action contribution", () => {
    const contributionIds = new Set(
      ALL_ACTION_CONTRIBUTIONS.map((contribution) => contribution.id)
    );
    const missing = Array.from(
      new Set(DEFAULT_KEYMAP.map((binding) => binding.commandId))
    ).filter((commandId) => !contributionIds.has(commandId));

    expect(missing).toEqual([]);
  });

  it("resolves every contribution aliasesKey in English and Chinese locales", () => {
    const aliasesKeys = ALL_ACTION_CONTRIBUTIONS.flatMap((contribution) =>
      contribution.aliasesKey ? [contribution.aliasesKey] : []
    );
    const invalid = aliasesKeys.filter((key) => {
      const enValue = nestedValue(en, key);
      const zhValue = nestedValue(zhCN, key);
      return !(
        Array.isArray(enValue) &&
        enValue.every((item) => typeof item === "string") &&
        Array.isArray(zhValue) &&
        zhValue.every((item) => typeof item === "string")
      );
    });

    expect(invalid).toEqual([]);
  });
});
