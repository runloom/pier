import { MARKDOWN_HTML_VOID_TAGS } from "./schema.ts";

export type MarkdownHtmlInlineToken =
  | { type: "comment" }
  | { type: "close"; name: string }
  | {
      attrs: Readonly<Record<string, string>>;
      name: string;
      selfClosing: boolean;
      type: "open";
    }
  | { type: "raw"; value: string };

const COMMENT_RE = /^<!--[\s\S]*-->$/u;
const CLOSE_RE = /^<\/([A-Za-z][\w:-]*)\s*>$/u;
const OPEN_RE = /^<([A-Za-z][\w:-]*)((?:\s[\s\S]*)?)>$/u;
const ATTR_RE =
  /([^\s"'>=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

export function parseMarkdownHtmlInlineToken(
  value: string
): MarkdownHtmlInlineToken {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<")) {
    return { type: "raw", value };
  }
  if (COMMENT_RE.test(trimmed)) {
    return { type: "comment" };
  }
  const close = CLOSE_RE.exec(trimmed);
  if (close?.[1]) {
    return { name: close[1].toLowerCase(), type: "close" };
  }
  if (trimmed.includes("><") || />[^<]+</u.test(trimmed)) {
    return { type: "raw", value };
  }
  const open = OPEN_RE.exec(trimmed);
  if (!open?.[1]) {
    return { type: "raw", value };
  }
  const name = open[1].toLowerCase();
  const selfClosing =
    /\/\s*>$/u.test(trimmed) || MARKDOWN_HTML_VOID_TAGS.has(name);
  return {
    attrs: parseHtmlAttributes(open[2] ?? ""),
    name,
    selfClosing,
    type: "open",
  };
}

function parseHtmlAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  for (const match of source.matchAll(ATTR_RE)) {
    const name = match[1]?.toLowerCase();
    if (!name || name === "/") continue;
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}
