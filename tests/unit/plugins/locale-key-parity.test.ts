import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "@shared/i18n/locales.ts";
import { describe, expect, it } from "vitest";

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
  return keys.filter((key) => !/\.aliases(\.|$|\[)/.test(key));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("builtin plugin locale key parity", () => {
  it.each([
    "files",
    "git",
  ] as const)("%s keeps non-alias keys aligned across shipped languages", (plugin) => {
    const expected = omitAliasLeaves(
      leafKeys(
        readJson(join(ROOT, `src/plugins/builtin/${plugin}/locales/en.json`))
      )
    ).toSorted();
    for (const locale of SUPPORTED_LOCALES) {
      const actual = omitAliasLeaves(
        leafKeys(
          readJson(
            join(ROOT, `src/plugins/builtin/${plugin}/locales/${locale}.json`)
          )
        )
      ).toSorted();
      expect(actual, locale).toEqual(expected);
    }
  });
});

describe("official plugin locale key parity", () => {
  it.each([
    "plugin-claude",
    "plugin-codex",
    "plugin-grok",
    "plugin-ssh",
    "plugin-agent-splits",
    "plugin-tasks",
  ] as const)("%s locales cover every shipped UI language", (pkg) => {
    const manifest = readJson(join(ROOT, `packages/${pkg}/plugin.json`)) as {
      locales?: Record<string, unknown>;
    };
    const locales = manifest.locales ?? {};
    const expected = omitAliasLeaves(leafKeys(locales.en)).toSorted();
    for (const locale of SUPPORTED_LOCALES) {
      expect(locales[locale], locale).toBeDefined();
      expect(
        omitAliasLeaves(leafKeys(locales[locale])).toSorted(),
        locale
      ).toEqual(expected);
    }
  });
});
