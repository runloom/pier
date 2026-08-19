import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "@shared/i18n/locales.ts";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en/index.ts";
import { ja } from "@/i18n/locales/ja/index.ts";
import { ko } from "@/i18n/locales/ko/index.ts";
import { zhCN } from "@/i18n/locales/zh-CN/index.ts";

const ROOT = process.cwd();

function leafKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

function omitAliasLeaves(keys: readonly string[]): string[] {
  return keys.filter((key) => !key.startsWith("commandPalette.aliases."));
}

const hostCatalogs = {
  en,
  ja,
  ko,
  "zh-CN": zhCN,
} as const;

describe("host locale key parity", () => {
  it("keeps the same non-alias leaf keys in every shipped language", () => {
    const expected = omitAliasLeaves(leafKeys(en)).toSorted();
    for (const locale of SUPPORTED_LOCALES) {
      const actual = omitAliasLeaves(leafKeys(hostCatalogs[locale])).toSorted();
      expect(actual, locale).toEqual(expected);
    }
  });

  it("keeps every shipped language registered in the host catalog", () => {
    expect(Object.keys(hostCatalogs).toSorted()).toEqual(
      [...SUPPORTED_LOCALES].toSorted()
    );
  });

  it("keeps alias JSON object keys aligned (array lengths may differ)", () => {
    const aliasKeySet = (locale: string) => {
      const raw = JSON.parse(
        readFileSync(
          join(
            ROOT,
            "src/renderer/i18n/locales",
            locale,
            "command-palette.aliases.json"
          ),
          "utf8"
        )
      ) as unknown;
      return leafKeys(raw)
        .map((key) => key.replace(/\[\d+]$/g, ""))
        .filter((key, index, all) => all.indexOf(key) === index)
        .toSorted();
    };
    const expected = aliasKeySet("en");
    for (const locale of SUPPORTED_LOCALES) {
      expect(aliasKeySet(locale), locale).toEqual(expected);
    }
  });
});
