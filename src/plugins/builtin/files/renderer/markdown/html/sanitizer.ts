import DOMPurify from "dompurify";
import { classifyMarkdownUrl, safeMarkdownUrl } from "../resource-elements.tsx";
import {
  isSafeHtmlAlign,
  isSafeHtmlDimension,
  isSafeHtmlSpan,
  MARKDOWN_HTML_ATTRS,
  MARKDOWN_HTML_FORBIDDEN_TAGS,
  MARKDOWN_HTML_TAGS,
} from "./schema.ts";

export function isSafeMarkdownHtmlHref(value: string): boolean {
  return safeMarkdownUrl(value) !== "";
}

export function isSafeMarkdownHtmlSrc(value: string): boolean {
  return classifyMarkdownUrl(value).kind === "relative";
}

export function pickSanitizedMarkdownHtmlAttrs(
  tag: string,
  raw: Readonly<Record<string, string>>
): Record<string, string> {
  const attrs: Record<string, string> = {};
  const align = raw.align;
  if (align && isSafeHtmlAlign(align)) {
    attrs.align = align.trim().toLowerCase();
  }
  if (Object.hasOwn(raw, "alt") && raw.alt !== undefined) {
    attrs.alt = raw.alt;
  }
  if (raw.title) attrs.title = raw.title;
  if (tag === "a") {
    const href = safeMarkdownUrl(raw.href);
    if (href) attrs.href = href;
  }
  if (tag === "img") {
    const src = raw.src;
    if (src && isSafeMarkdownHtmlSrc(src)) {
      attrs.src = src.trim();
    }
  }
  if (raw.width && isSafeHtmlDimension(raw.width)) {
    attrs.width = raw.width.trim();
  }
  if (raw.height && isSafeHtmlDimension(raw.height)) {
    attrs.height = raw.height.trim();
  }
  if (raw.colspan && isSafeHtmlSpan(raw.colspan)) {
    attrs.colspan = raw.colspan.trim();
  }
  if (raw.rowspan && isSafeHtmlSpan(raw.rowspan)) {
    attrs.rowspan = raw.rowspan.trim();
  }
  if (tag === "ol" && raw.start && /^-?\d+$/u.test(raw.start.trim())) {
    attrs.start = raw.start.trim();
  }
  if (tag === "details" && Object.hasOwn(raw, "open")) {
    attrs.open = "";
  }
  return attrs;
}

export function sanitizeMarkdownHtml(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    ADD_FORBID_CONTENTS: ["script", "style", "template"],
    ALLOWED_ATTR: [...MARKDOWN_HTML_ATTRS],
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
    ALLOWED_TAGS: [...MARKDOWN_HTML_TAGS],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [...MARKDOWN_HTML_FORBIDDEN_TAGS],
    RETURN_DOM_FRAGMENT: true,
  });

  for (const element of fragment.querySelectorAll("*")) {
    sanitizeMarkdownHtmlElement(element);
  }
  return fragment;
}

function sanitizeMarkdownHtmlElement(element: Element): void {
  const tag = element.tagName.toLowerCase();
  const raw: Record<string, string> = {};
  for (const attribute of element.attributes) {
    raw[attribute.name.toLowerCase()] = attribute.value;
  }
  const next = pickSanitizedMarkdownHtmlAttrs(tag, raw);
  for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
    const attribute = element.attributes.item(index);
    if (attribute) element.removeAttribute(attribute.name);
  }
  for (const [name, value] of Object.entries(next)) {
    element.setAttribute(name, value);
  }
}
