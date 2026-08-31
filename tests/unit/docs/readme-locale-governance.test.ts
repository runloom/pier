import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@shared/i18n/locales.ts";
import { describe, expect, it } from "vitest";
import {
  ATTENTION_PRODUCT_TERMS,
  CJK_PROSE_BANNED,
  CORE_PRODUCT_TERMS,
  headingSignature,
  languageBar,
  localeNameSequence,
  prose,
  README_BY_LOCALE,
  readFrontDoor,
  readmePath,
  siblingReadmeFile,
  titleIndex,
} from "./readme-locale.ts";

const ROOT = process.cwd();

const CLI_DIR = ".pier/canvases/pier-cli-user-manual";

interface FrontDoor {
  anchors: readonly string[];
  dir: string;
  id: string;
  requireAttentionTerm: boolean;
}

const FRONT_DOORS: readonly FrontDoor[] = [
  {
    id: "root README",
    dir: "",
    requireAttentionTerm: true,
    anchors: [
      "https://pier.codes",
      "https://github.com/runloom/pier/releases",
      "docs/README.md",
      "pier-cli-user-manual",
      "CONTRIBUTING.md",
      "CHANGELOG.md",
      "docs/development.md",
      "docs/plugins.md",
      "SECURITY.md",
      "pnpm bootstrap",
      "pnpm setup:worktree",
      "pnpm check",
      "pier status --json",
    ],
  },
  {
    id: "CLI GitHub manual",
    dir: CLI_DIR,
    requireAttentionTerm: false,
    anchors: [
      "pier status --json",
      "pier . --json",
      "pier-cli-user-manual.canvas.tsx",
      "data.json",
      "pnpm --silent cli:dev",
      "agents catalog",
      "worktrees list",
    ],
  },
];

function readDoor(door: FrontDoor, locale: SupportedLocale): string {
  return readFrontDoor(ROOT, door.dir, locale);
}

describe("user-facing GitHub README locales", () => {
  it("documents root and CLI four-locale front doors", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const docsIndex = readFileSync(join(ROOT, "docs/README.md"), "utf8");
    expect(agents).toContain("根 README 与产品语言集合一致");
    expect(agents).toContain("CLI GitHub 手册同样四语");
    expect(agents).toContain(
      "tests/unit/docs/readme-locale-governance.test.ts"
    );
    expect(docsIndex).toContain("README.en.md");
    expect(docsIndex).toContain("README.ja.md");
    expect(docsIndex).toContain("README.ko.md");
    expect(docsIndex).toContain("SUPPORTED_LOCALES");
    expect(docsIndex).toContain("pier-cli-user-manual/README.md");
  });

  it.each(
    FRONT_DOORS
  )("$id keeps GitHub default as Simplified Chinese with en/ja/ko siblings", (door) => {
    expect(README_BY_LOCALE["zh-CN"]).toBe("README.md");
    expect(existsSync(join(ROOT, readmePath(door.dir, "zh-CN")))).toBe(true);
    expect(
      existsSync(join(ROOT, door.dir, "README.zh-CN.md")),
      `${door.id} README.zh-CN.md`
    ).toBe(false);
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        existsSync(join(ROOT, readmePath(door.dir, locale))),
        `${door.id} ${locale}`
      ).toBe(true);
    }
  });

  it.each(
    FRONT_DOORS
  )("$id puts a language bar before the title using native names and SUPPORTED_LOCALES order", (door) => {
    for (const locale of SUPPORTED_LOCALES) {
      const markdown = readDoor(door, locale);
      const bar = languageBar(markdown);
      const label = `${door.id} ${locale}`;
      expect(markdown.indexOf(bar), label).toBeLessThan(titleIndex(markdown));
      expect(localeNameSequence(bar), label).toEqual(
        SUPPORTED_LOCALES.map((item) => LOCALE_NATIVE_NAMES[item])
      );

      for (const other of SUPPORTED_LOCALES) {
        const name = LOCALE_NATIVE_NAMES[other];
        const file = siblingReadmeFile(other);
        const strong = new RegExp(`<strong>\\s*${name}\\s*</strong>`);
        const link = new RegExp(
          `<a href="(?:\\./)?${file}">\\s*${name}\\s*</a>`
        );
        if (other === locale) {
          expect(bar, label).toMatch(strong);
          expect(bar, label).not.toMatch(link);
        } else {
          expect(bar, label).toMatch(link);
          expect(bar, label).not.toMatch(strong);
        }
      }
    }
  });

  it.each(
    FRONT_DOORS
  )("$id keeps the same heading outline and shared product anchors across locales", (door) => {
    const expectedSignature = headingSignature(readDoor(door, "zh-CN"));
    expect(expectedSignature.length).toBeGreaterThan(0);
    for (const locale of SUPPORTED_LOCALES) {
      const markdown = readDoor(door, locale);
      const label = `${door.id} ${locale}`;
      expect(headingSignature(markdown), label).toEqual(expectedSignature);
      expect(markdown, label).not.toMatch(/!\[|<img\b/i);
      expect(markdown, label).not.toMatch(/docs\/cli\.md/);
      for (const anchor of door.anchors) {
        expect(markdown, `${label} ${anchor}`).toContain(anchor);
      }
      if (locale !== "zh-CN") {
        expect(markdown, label).toContain("source: README.md");
      }
    }
  });

  it.each(
    FRONT_DOORS
  )("$id uses frozen product terms and keeps CJK prose free of English implementation words", (door) => {
    for (const locale of SUPPORTED_LOCALES) {
      const markdown = readDoor(door, locale);
      const body = prose(markdown).toLowerCase();
      const label = `${door.id} ${locale}`;
      for (const term of CORE_PRODUCT_TERMS[locale]) {
        expect(body, `${label} ${term}`).toContain(term.toLowerCase());
      }
      if (door.requireAttentionTerm) {
        expect(body, `${label} attention`).toContain(
          ATTENTION_PRODUCT_TERMS[locale].toLowerCase()
        );
      }
      if (locale === "en") {
        expect(body, label).not.toMatch(/\bneeds you\b/);
        continue;
      }
      const rawProse = prose(markdown);
      for (const { id, pattern } of CJK_PROSE_BANNED) {
        expect(rawProse, `${label} ${id}`).not.toMatch(pattern);
      }
    }
  });

  it("points each root README locale at the matching CLI GitHub manual", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const markdown = readFrontDoor(ROOT, "", locale);
      const target = readmePath(CLI_DIR, locale);
      expect(markdown, locale).toContain(target);
    }
  });
});
