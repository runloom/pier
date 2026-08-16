/**
 * Settings keybinding list search: every whitespace token must appear in the
 * haystack (title, description, id, or shortcut label). Modifier aliases and
 * compact chords (`⌘C`, `cmd+shift+c`) are normalized before matching.
 */

const MODIFIER_SYMBOLS: Readonly<Record<string, string>> = {
  "⌘": " cmd ",
  "⌃": " ctrl ",
  "⌥": " alt ",
  "⇧": " shift ",
};

function normalizeShortcutSearchText(text: string): string {
  let next = text.toLowerCase();
  for (const [symbol, token] of Object.entries(MODIFIER_SYMBOLS)) {
    next = next.replaceAll(symbol, token);
  }
  return next
    .replaceAll("+", " ")
    .replace(/\bcommand\b/g, "cmd")
    .replace(/\bcontrol\b/g, "ctrl")
    .replace(/\boption\b/g, "alt")
    .replace(/\bopt\b/g, "alt")
    .replace(/\bmod\b/g, "cmd")
    .replace(/\s+/g, " ")
    .trim();
}

function expandShortcutHaystack(haystack: string): string {
  const normalized = normalizeShortcutSearchText(haystack);
  const extras: string[] = [];
  if (/\bcmd\b/.test(normalized)) {
    extras.push("ctrl", "control", "command", "cmd");
  }
  if (/\balt\b/.test(normalized)) {
    extras.push("opt", "option");
  }
  return extras.length > 0 ? `${normalized} ${extras.join(" ")}` : normalized;
}

export function matchKeybindingQuery(haystack: string, query: string): boolean {
  const tokens = normalizeShortcutSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const hay = expandShortcutHaystack(haystack);
  return tokens.every((token) => hay.includes(token));
}

export function keybindingSearchHaystack(fields: readonly string[]): string {
  return fields.filter((field) => field.length > 0).join("\n");
}
