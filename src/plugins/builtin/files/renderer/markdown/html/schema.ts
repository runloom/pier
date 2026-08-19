/** GitHub-style Markdown HTML allowlist (safe subset, not a browser). */

export const MARKDOWN_HTML_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "span",
  "strike",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "tt",
  "ul",
  "var",
] as const;

export type MarkdownHtmlTag = (typeof MARKDOWN_HTML_TAGS)[number];

export const MARKDOWN_HTML_TAG_SET = new Set<string>(MARKDOWN_HTML_TAGS);

export const MARKDOWN_HTML_VOID_TAGS = new Set(["br", "hr", "img"]);

export const MARKDOWN_HTML_FORBIDDEN_TAGS = [
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
] as const;

export const MARKDOWN_HTML_DROP_CHILDREN_TAGS = new Set([
  "embed",
  "iframe",
  "math",
  "object",
  "script",
  "style",
  "svg",
  "template",
  "textarea",
]);

export const MARKDOWN_HTML_ATTRS = [
  "align",
  "alt",
  "colspan",
  "height",
  "href",
  "open",
  "rowspan",
  "src",
  "start",
  "title",
  "width",
] as const;

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function isMarkdownHtmlHeadingTag(
  name: string
): name is "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return HEADING_TAGS.has(name);
}

export function isMarkdownHtmlTag(name: string): name is MarkdownHtmlTag {
  return MARKDOWN_HTML_TAG_SET.has(name);
}

export function htmlAlignClass(align: string | undefined): string | undefined {
  const value = align?.trim().toLowerCase();
  if (value === "center") return "text-center";
  if (value === "right") return "text-right";
  if (value === "left") return "text-left";
  if (value === "justify") return "text-justify";
  return;
}

export function isSafeHtmlAlign(value: string): boolean {
  return htmlAlignClass(value) !== undefined;
}

export function isSafeHtmlDimension(value: string): boolean {
  return /^\d+$/u.test(value.trim());
}

export function isSafeHtmlSpan(value: string): boolean {
  return /^[1-9]\d*$/u.test(value.trim());
}
