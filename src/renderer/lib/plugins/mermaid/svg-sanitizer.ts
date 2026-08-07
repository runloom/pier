// Official Mermaid uses sanitized XHTML labels inside foreignObject even when
// flowchart htmlLabels is disabled. Keep those labels, but reject executable
// containers, event attributes and non-local URLs below.
const DISALLOWED_SVG_ELEMENTS = "script,iframe,object,embed";
const URL_PRESENTATION_ATTRIBUTES = new Set([
  "clip-path",
  "cursor",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);

/**
 * HTML void elements Mermaid (and browsers) may emit without XML self-close.
 * Only normalize these; never invent closers for arbitrary tags.
 */
const HTML_VOID_TAG_NAMES =
  "area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr";

/**
 * Attribute matching that respects quoted values so `title="a>b"` does not
 * truncate the tag rewrite (DOMParser would otherwise see invalid markup).
 */
const VOID_ATTR_CHUNK =
  "(?:\\s+[A-Za-z_:][\\w:.-]*(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?)";

function hasUnsafeCssUrl(value: string): boolean {
  if (value.includes("\\")) {
    return true;
  }
  const matches = value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu);
  for (const match of matches) {
    if (!match[2]?.trim().startsWith("#")) {
      return true;
    }
  }
  return false;
}

/**
 * Mermaid multi-line labels emit HTML void tags (`<br>`) inside foreignObject.
 * `DOMParser` with `image/svg+xml` requires well-formed XML, so rewrite those
 * void tags to self-closing form before parse. Already self-closed tags are
 * left unchanged in effect (normalized to ` />`).
 */
export function normalizeMermaidSvgForXmlParse(svg: string): string {
  const voidOpen = new RegExp(
    `<(${HTML_VOID_TAG_NAMES})\\b(${VOID_ATTR_CHUNK}*)\\s*/?>`,
    "giu"
  );
  return svg.replace(voidOpen, (_full, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    const attrs = rawAttrs
      .trim()
      .replace(/\/\s*$/u, "")
      .trim();
    return attrs.length > 0 ? `<${name} ${attrs} />` : `<${name} />`;
  });
}

/**
 * Removes executable and remote-resource SVG content before it reaches the
 * renderer. `foreignObject` remains valid because Mermaid v11 uses it for
 * plain text labels under strict security mode.
 */
export function sanitizeMermaidSvg(svg: string): string | null {
  const normalized = normalizeMermaidSvgForXmlParse(svg);
  const documentNode = new DOMParser().parseFromString(
    normalized,
    "image/svg+xml"
  );
  const root = documentNode.documentElement;
  if (
    root.localName !== "svg" ||
    documentNode.querySelector("parsererror") ||
    documentNode.querySelector(DISALLOWED_SVG_ELEMENTS)
  ) {
    return null;
  }

  let changed = normalized !== svg;
  for (const styleElement of root.querySelectorAll("style")) {
    const original = styleElement.textContent ?? "";
    const withoutImports = original.replace(
      /@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*;?/giu,
      ""
    );
    const normalizedFonts = withoutImports.replace(
      /font-family\s*:[^;}]+/giu,
      "font-family:var(--font-sans)"
    );
    if (hasUnsafeCssUrl(normalizedFonts)) {
      return null;
    }
    if (normalizedFonts !== original) {
      styleElement.textContent = normalizedFonts;
      changed = true;
    }
  }

  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        return null;
      }
      if (
        (name === "href" || name === "xlink:href" || name === "src") &&
        value !== "" &&
        !value.startsWith("#")
      ) {
        return null;
      }
      if (
        (name === "style" || URL_PRESENTATION_ATTRIBUTES.has(name)) &&
        (hasUnsafeCssUrl(value) || /expression\s*\(/iu.test(value))
      ) {
        return null;
      }
    }
  }
  return changed ? new XMLSerializer().serializeToString(root) : svg;
}
