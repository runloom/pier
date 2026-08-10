/**
 * Markdown preview document font — same model as Appearance UI/mono fonts:
 * user enters primary family name(s); we prepend them to a built-in fallback chain.
 */
import {
  FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT,
  FILES_MARKDOWN_READING_FONT_FAMILY_FALLBACK,
} from "../../settings.ts";

const RE_QUOTED = /^["']/u;
const RE_HAS_SPACE = /\s/u;
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "ui-rounded",
  "-apple-system",
]);

function quoteFontName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (RE_QUOTED.test(trimmed)) return trimmed;
  if (GENERIC_FAMILIES.has(trimmed)) return trimmed;
  return RE_HAS_SPACE.test(trimmed) ? `"${trimmed}"` : trimmed;
}

function parseUserInput(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Reject CSS breakout; return trimmed user primary input or the default name.
 */
export function sanitizeReadingFontPrimary(value: unknown): string {
  if (typeof value !== "string") {
    return FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT;
  }
  const trimmed = value.trim().replaceAll(/\s+/gu, " ");
  if (!trimmed) {
    // Empty means "use fallback chain only" (same as Appearance empty UI font).
    return "";
  }
  if (/[;{}\\]|url\s*\(|expression\s*\(|@import|<\/?[a-z]/iu.test(trimmed)) {
    return FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT;
  }
  if (!/^[\w\s,"'\-.\u0080-\uFFFF]+$/u.test(trimmed)) {
    return FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT;
  }
  return trimmed;
}

/** Full CSS font-family for custom Markdown prose. */
export function computeMarkdownReadingFontFamily(userPrimary: string): string {
  const primary = parseUserInput(sanitizeReadingFontPrimary(userPrimary));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of [
    ...primary,
    ...FILES_MARKDOWN_READING_FONT_FAMILY_FALLBACK,
  ]) {
    const lower = name.toLowerCase().replaceAll(/["']/gu, "");
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    const quoted = quoteFontName(name);
    if (quoted) result.push(quoted);
  }
  return result.join(", ");
}
