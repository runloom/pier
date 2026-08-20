/**
 * Locate an @import / @source string literal under a document offset.
 * Used for Go to Definition on CSS package and relative imports.
 */

export interface CssImportAtPosition {
  /** Inclusive start offset of the quoted specifier (after quote). */
  contentFrom: number;
  /** Exclusive end offset of the quoted specifier (before closing quote). */
  contentTo: number;
  /** Full match including @import and quotes (for debugging). */
  fullFrom: number;
  fullTo: number;
  kind: "import" | "source";
  /** Unquoted specifier, e.g. tailwindcss or ../theme.css */
  specifier: string;
}

const IMPORT_RE =
  /@(import|source)\s+(?:url\(\s*)?(['"])([^'"]+)\2\s*\)?\s*;?/giu;

/**
 * If `offset` sits inside an @import / @source string, return that specifier.
 */
export function cssImportAtOffset(
  text: string,
  offset: number
): CssImportAtPosition | null {
  if (offset < 0 || offset > text.length) {
    return null;
  }
  IMPORT_RE.lastIndex = 0;
  let match = IMPORT_RE.exec(text);
  while (match) {
    const fullFrom = match.index;
    const fullTo = fullFrom + match[0].length;
    const quote = match[2] ?? '"';
    const specifier = match[3] ?? "";
    const kindRaw = match[1]?.toLowerCase();
    const kind = kindRaw === "source" ? "source" : "import";
    // Specifier is inside quotes: find quote start after @import/url(
    const beforeSpec = match[0].indexOf(quote + specifier + quote);
    if (beforeSpec < 0) {
      match = IMPORT_RE.exec(text);
      continue;
    }
    const contentFrom = fullFrom + beforeSpec + 1;
    const contentTo = contentFrom + specifier.length;
    // Allow click on the whole @import statement, not only inside quotes.
    if (offset >= fullFrom && offset <= fullTo && specifier.length > 0) {
      return {
        contentFrom,
        contentTo,
        fullFrom,
        fullTo,
        kind,
        specifier,
      };
    }
    match = IMPORT_RE.exec(text);
  }
  return null;
}

export function isCssLikePath(path: string): boolean {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  return (
    lower.endsWith(".css") ||
    lower.endsWith(".scss") ||
    lower.endsWith(".sass") ||
    lower.endsWith(".less") ||
    lower.endsWith(".styl")
  );
}
