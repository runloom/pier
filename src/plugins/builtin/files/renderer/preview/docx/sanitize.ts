const BLOCKED_TAGS = new Set([
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
]);

const BLOCKED_ATTRIBUTES = new Set(["srcdoc", "xlink:href"]);

const STYLE_URL = /url\(([^)]*)\)/giu;
const STYLE_IMPORT = /@import[^;]*;?/giu;
const INLINE_DANGER = /(?:expression|url)\(/iu;

function strippedUrlValue(raw: string): boolean {
  const value = raw
    .trim()
    .replace(/^['"]|['"]$/gu, "")
    .trim();
  return value.startsWith("data:");
}

function sanitizeStyleText(css: string): string {
  return css
    .replace(STYLE_IMPORT, "")
    .replace(STYLE_URL, (match, raw: string) =>
      strippedUrlValue(raw) ? match : "none"
    );
}

function sanitizeElement(element: Element): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || BLOCKED_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === "style" && INLINE_DANGER.test(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  }

  if (element instanceof HTMLImageElement) {
    const source = element.getAttribute("src");
    if (!source?.startsWith("data:image/")) {
      element.removeAttribute("src");
      element.setAttribute("data-pier-blocked-image", "true");
    }
  }

  if (element instanceof HTMLStyleElement) {
    element.textContent = sanitizeStyleText(element.textContent ?? "");
  }
}

/**
 * Strip active content from rendered DOCX nodes (detached content and style
 * containers, or the committed shadow tree). CSP is the first network line;
 * this pass removes anything that could still touch the host.
 */
export function sanitizeDocxShadow(root: ShadowRoot | HTMLElement): void {
  for (const element of [...root.querySelectorAll("*")]) {
    if (BLOCKED_TAGS.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    sanitizeElement(element);
  }
}
