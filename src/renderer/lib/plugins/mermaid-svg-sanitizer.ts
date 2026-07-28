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
 * Removes executable and remote-resource SVG content before it reaches the
 * renderer. `foreignObject` remains valid because Mermaid v11 uses it for
 * plain text labels under strict security mode.
 */
export function sanitizeMermaidSvg(svg: string): string | null {
  const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = documentNode.documentElement;
  if (
    root.localName !== "svg" ||
    documentNode.querySelector("parsererror") ||
    documentNode.querySelector(DISALLOWED_SVG_ELEMENTS)
  ) {
    return null;
  }

  let changed = false;
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
