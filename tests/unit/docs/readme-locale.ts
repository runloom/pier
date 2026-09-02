import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@shared/i18n/locales.ts";

export const README_BY_LOCALE = {
  "zh-CN": "README.md",
  en: "README.en.md",
  ja: "README.ja.md",
  ko: "README.ko.md",
} as const satisfies Record<SupportedLocale, string>;

export const CORE_PRODUCT_TERMS: Record<SupportedLocale, readonly string[]> = {
  "zh-CN": ["智能体", "工作树"],
  en: ["agent", "worktree"],
  ja: ["エージェント", "作業ツリー"],
  ko: ["에이전트", "작업 트리"],
};

export const ATTENTION_PRODUCT_TERMS: Record<SupportedLocale, string> = {
  "zh-CN": "需要你处理",
  en: "need attention",
  ja: "対応が必要",
  ko: "처리 필요",
};

export const CJK_PROSE_BANNED: ReadonlyArray<{ id: string; pattern: RegExp }> =
  [
    { id: "Agent", pattern: /\bAgent\b/ },
    { id: "Needs you", pattern: /\bNeeds you\b/i },
    { id: "worktree", pattern: /\bworktree\b/i },
  ];

export function siblingReadmeFile(locale: SupportedLocale): string {
  return README_BY_LOCALE[locale];
}

export function readmePath(dir: string, locale: SupportedLocale): string {
  const file = siblingReadmeFile(locale);
  return dir === "" ? file : `${dir}/${file}`;
}

export function readFrontDoor(
  root: string,
  dir: string,
  locale: SupportedLocale
): string {
  return readFileSync(join(root, readmePath(dir, locale)), "utf8");
}

export function prose(markdown: string): string {
  return markdown
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/`[^`]*`/g, " ");
}

export function languageBar(markdown: string): string {
  const paragraphs = markdown.match(/<p align="center">[\s\S]*?<\/p>/g) ?? [];
  const bar = paragraphs.find((paragraph) =>
    SUPPORTED_LOCALES.every((locale) =>
      paragraph.includes(LOCALE_NATIVE_NAMES[locale])
    )
  );
  if (!bar) {
    throw new Error("missing language bar with every shipped locale name");
  }
  return bar;
}

export function titleIndex(markdown: string): number {
  const html = markdown.indexOf("<h1");
  const atx = markdown.search(/^# /m);
  const hits = [html, atx].filter((index) => index >= 0);
  if (hits.length === 0) {
    throw new Error("missing document title");
  }
  return Math.min(...hits);
}

export function headingSignature(markdown: string): string[] {
  return [...markdown.matchAll(/^(#{2,3}) /gm)].map((match) => {
    const marks = match[1];
    if (!marks) {
      throw new Error("heading signature match missing marks");
    }
    return marks;
  });
}

export function localeNameSequence(bar: string): string[] {
  const names = SUPPORTED_LOCALES.map((locale) => LOCALE_NATIVE_NAMES[locale]);
  return [...bar.matchAll(new RegExp(names.join("|"), "g"))].map((match) => {
    const name = match[0];
    if (!name) {
      throw new Error("locale name match missing text");
    }
    return name;
  });
}
