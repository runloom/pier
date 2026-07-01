import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { en } from "@/i18n/locales/en/index.ts";
import { zhCN } from "@/i18n/locales/zh-CN/index.ts";
import { ALL_ACTION_CONTRIBUTIONS } from "@/lib/actions/all-action-contributions.ts";
import { resolveI18nAliases } from "@/lib/actions/renderer-action-runtime.ts";
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

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

describe("action contribution boundary", () => {
  beforeAll(async () => {
    await initI18n();
  });

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

  it("does not declare aliases on host action contributions", () => {
    const offenders = ALL_ACTION_CONTRIBUTIONS.filter((contribution) =>
      Object.hasOwn(contribution, "aliases")
    ).map((contribution) => contribution.id);

    expect(offenders).toEqual([]);
  });

  it("resolves host action aliases by action id in English and Chinese locales", () => {
    const aliasKeys = ALL_ACTION_CONTRIBUTIONS.map(
      (contribution) => `commandPalette.aliases.${contribution.id}`
    );
    const invalid = aliasKeys.filter((key) => {
      const enValue = nestedValue(en, key);
      const zhValue = nestedValue(zhCN, key);
      return !(
        isOptionalStringArray(enValue) && isOptionalStringArray(zhValue)
      );
    });

    expect(invalid).toEqual([]);
  });

  it("keeps each host aliases locale scoped to its own language", () => {
    expect(en.commandPalette.aliases.locale.system).toEqual([
      "system",
      "auto",
      "follow system",
    ]);
    expect(en.commandPalette.aliases.locale.en).toEqual(["en", "english"]);
    expect(en.commandPalette.aliases.pier.view.zoomIn).toEqual([
      "zoom in",
      "increase zoom",
    ]);

    expect(zhCN.commandPalette.aliases.locale.system).toEqual([
      "系统",
      "跟随系统",
      "自动",
      "xitong",
      "zidong",
    ]);
    expect(zhCN.commandPalette.aliases.locale.en).toEqual([
      "英文",
      "英语",
      "yingwen",
    ]);
    expect(zhCN.commandPalette.aliases.pier.view.zoomIn).toEqual([
      "放大",
      "放大界面",
      "fangda",
    ]);
  });

  it("resolves host aliases from every registered locale", async () => {
    await i18next.changeLanguage("en");

    expect(
      resolveI18nAliases("commandPalette.aliases.pier.view.zoomIn")
    ).toEqual(["zoom in", "increase zoom", "放大", "放大界面", "fangda"]);
  });
});
