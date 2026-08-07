import { describe, expect, it } from "vitest";
import { renderOfficialMermaid } from "@/lib/live-modules/official-mermaid-renderer.ts";
import {
  normalizeMermaidSvgForXmlParse,
  sanitizeMermaidSvg,
} from "@/lib/plugins/mermaid/svg-sanitizer.ts";

/**
 * Mermaid multi-line labels emit HTML void tags inside foreignObject.
 * The sanitizer must accept that production shape without weakening XSS gates.
 */
const MERMAID_MULTILINE_FO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40">',
  '<foreignObject width="100" height="30">',
  '<div xmlns="http://www.w3.org/1999/xhtml">',
  '<span class="nodeLabel"><p>line1<br>line2</p></span>',
  "</div>",
  "</foreignObject>",
  "</svg>",
].join("");

describe("sanitizeMermaidSvg", () => {
  it("normalizes Mermaid HTML void tags in foreignObject and keeps the label", () => {
    const sanitized = sanitizeMermaidSvg(MERMAID_MULTILINE_FO_SVG);
    expect(sanitized).not.toBeNull();
    expect(sanitized).toContain("line1");
    expect(sanitized).toContain("line2");
    expect(sanitized).toMatch(/<br\s*\/>/i);
    expect(sanitized).not.toMatch(/<br\s*>/i);
  });

  it("keeps quoted attribute values that contain > when self-closing voids", () => {
    const raw = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">',
      '<br class="x" title="a>b">',
      "</div></foreignObject></svg>",
    ].join("");
    const normalized = normalizeMermaidSvgForXmlParse(raw);
    expect(normalized).toContain('title="a>b"');
    expect(normalized).toContain('<br class="x" title="a>b" />');
    const sanitized = sanitizeMermaidSvg(raw);
    expect(sanitized).not.toBeNull();
    expect(sanitized).toMatch(/title="a(?:&gt;|>)b"/);
  });
  it("still rejects executable containers and remote URL attributes", () => {
    expect(
      sanitizeMermaidSvg("<svg><script>alert(1)</script></svg>")
    ).toBeNull();
    expect(
      sanitizeMermaidSvg(
        '<svg><a href="https://example.com"><text>x</text></a></svg>'
      )
    ).toBeNull();
    expect(
      sanitizeMermaidSvg(
        '<svg><rect fill="url(https://example.com/paint.svg#p)" /></svg>'
      )
    ).toBeNull();
  });

  it("renders official multi-line flowchart labels through the full pipeline", async () => {
    const source = [
      "flowchart TB",
      '  A["line1\\nline2"] --> B["ok"]',
      '  B --> C["中文单行"]',
    ].join("\n");
    const result = await renderOfficialMermaid(source, "dark");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.svg).toContain("<svg");
      expect(result.svg).not.toContain("<script");
      expect(result.svg).toMatch(/line1/u);
      expect(result.svg).toMatch(/line2/u);
    }
  }, 15_000);
});
