import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

const FORBIDDEN_TAGS = [
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "math",
  "object",
  "script",
  "style",
  "svg",
  "template",
];

/**
 * Highlight classes allowed on span/code in hover HTML:
 * - `tok-*` from @lezer/highlight classHighlighter (stable)
 * - CodeMirror StyleModule classes from highlightingFor (e.g. ͼs, ͼ10)
 *   used when LSPPlugin.docToHTML highlights markdown fences
 */
const HIGHLIGHT_CLASS = /^(tok-[A-Za-z0-9_-]+|[\u0370-\u03FF][A-Za-z0-9_-]*)$/u;

export function canonicalFilesLspHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function removeAllAttributes(element: Element): void {
  for (let attribute = element.attributes.item(0); attribute; ) {
    element.removeAttribute(attribute.name);
    attribute = element.attributes.item(0);
  }
}

function retainTokenClasses(element: Element): void {
  const value = element.getAttribute("class");
  if (value === null) {
    return;
  }

  const classes = value
    .trim()
    .split(/\s+/)
    .filter((className) => HIGHLIGHT_CLASS.test(className));
  if (classes.length === 0) {
    element.removeAttribute("class");
    return;
  }
  element.setAttribute("class", classes.join(" "));
}

function sanitizeElementAttributes(element: Element): void {
  if (element.tagName === "A") {
    const canonicalUrl = canonicalFilesLspHttpsUrl(
      element.getAttribute("href") ?? ""
    );
    if (canonicalUrl === null) {
      element.replaceWith(
        element.ownerDocument.createTextNode(element.textContent ?? "")
      );
      return;
    }

    removeAllAttributes(element);
    element.setAttribute("href", canonicalUrl);
    element.setAttribute("rel", "noopener noreferrer");
    return;
  }

  for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
    const attribute = element.attributes.item(index);
    if (attribute && attribute.name !== "class") {
      element.removeAttribute(attribute.name);
    }
  }
  retainTokenClasses(element);
}

export function sanitizeFilesLspHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ADD_FORBID_CONTENTS: ["script", "style", "template"],
    ALLOWED_ATTR: ["class", "href"],
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
    ALLOWED_TAGS,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: FORBIDDEN_TAGS,
    RETURN_DOM_FRAGMENT: true,
  });

  for (const element of fragment.querySelectorAll("*")) {
    sanitizeElementAttributes(element);
  }

  const container = fragment.ownerDocument.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}
