/** Small paste: full text into the editor. */
export const PASTE_SMALL_MAX_CHARS = 800;
export const PASTE_SMALL_MAX_LINES = 5;

/** Large paste: path-style attachment (legacy 10k threshold). */
export const PASTE_LARGE_MIN_CHARS = 10_000;

/** Alias for PASTE_LARGE_MIN_CHARS (composer-paste re-export surface). */
export const LARGE_PASTE_CHAR_THRESHOLD = PASTE_LARGE_MIN_CHARS;

export type PlainPasteTier = "small" | "medium" | "large";

/**
 * Line count for paste classification.
 * Empty string → 0; trailing single `\n` does not add an extra blank line.
 */
export function countPasteLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const parts = text.split("\n");
  if (parts.length > 1 && parts.at(-1) === "") {
    return parts.length - 1;
  }
  return parts.length;
}

export function classifyPlainPaste(text: string): PlainPasteTier {
  const charCount = text.length;
  if (charCount >= PASTE_LARGE_MIN_CHARS) {
    return "large";
  }
  const lineCount = countPasteLines(text);
  if (charCount < PASTE_SMALL_MAX_CHARS && lineCount <= PASTE_SMALL_MAX_LINES) {
    return "small";
  }
  return "medium";
}
