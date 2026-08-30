import { bakeSvgForStandalonePreview } from "@pier/ui/image-preview/bake-svg-for-standalone-preview.ts";
import { describe, expect, it, vi } from "vitest";

describe("bakeSvgForStandalonePreview", () => {
  it("bakes concrete theme tokens so data-URL previews are not black boxes", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((_element: Element) =>
        ({
          getPropertyValue: (name: string) => {
            if (name === "--background") return "oklch(1 0 0)";
            if (name === "--foreground") return "oklch(0.2 0 0)";
            if (name === "--muted-foreground") return "oklch(0.45 0 0)";
            return "";
          },
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute(
      "style",
      "--bg:var(--background);--fg:var(--foreground);--line:var(--border)"
    );
    const markup = bakeSvgForStandalonePreview(svg);
    expect(markup).toContain("--bg:oklch(1 0 0)");
    expect(markup).toContain("--fg:oklch(0.2 0 0)");
    expect(markup).toContain("--border:color-mix(in srgb, oklch(0.2 0 0) 22%");
    expect(markup).toContain("--line:color-mix(in srgb, oklch(0.2 0 0) 45%");
    expect(markup).toContain("--accent:color-mix(in srgb, oklch(0.2 0 0) 45%");
    expect(markup).not.toMatch(/--border:var\(--border\)/);
    // The paper color travels inside the image so host chrome (app theme)
    // cannot bleed through the transparent diagram background.
    expect(markup).toContain('data-slot="svg-paper-backdrop"');
    expect(markup).toContain('fill="oklch(1 0 0)"');
  });

  it("covers non-zero viewBox origins with the paper backdrop", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((_element: Element) =>
        ({
          getPropertyValue: (name: string) => {
            if (name === "--background") return "oklch(1 0 0)";
            if (name === "--foreground") return "oklch(0.2 0 0)";
            return "";
          },
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-10 -5 240 120");

    const markup = bakeSvgForStandalonePreview(svg);
    // Percentages anchor at user-space (0,0), which would leave the
    // [-10,0] × [-5,0] band unpainted; user units cover the exact viewBox.
    expect(markup).toContain(
      '<rect x="-10" y="-5" width="240" height="120" fill="oklch(1 0 0)" data-slot="svg-paper-backdrop"'
    );
  });

  it("skips the backdrop and token bake when paper tokens are unavailable", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((_element: Element) =>
        ({
          getPropertyValue: (_name: string) => "",
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");

    const markup = bakeSvgForStandalonePreview(svg);
    // Nothing sampled → nothing baked; only the intrinsic-size pin applies.
    expect(markup).not.toContain("svg-paper-backdrop");
    expect(markup).not.toContain("--bg:");
    expect(markup).toContain('width="100"');
  });

  it("paints the paper backdrop under the diagram, not over it", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((_element: Element) =>
        ({
          getPropertyValue: (name: string) => {
            if (name === "--background") return "oklch(1 0 0)";
            if (name === "--foreground") return "oklch(0.2 0 0)";
            return "";
          },
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    const content = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.append(content);

    const markup = bakeSvgForStandalonePreview(svg);
    const backdropIndex = markup.indexOf('data-slot="svg-paper-backdrop"');
    const contentIndex = markup.indexOf("<g");
    expect(backdropIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(-1);
    expect(backdropIndex).toBeLessThan(contentIndex);
  });

  it("samples paper-root tokens and pins viewBox size for zoomable previews", () => {
    const paper = document.createElement("div");
    paper.setAttribute("data-slot", "markdown-preview-root");
    document.body.append(paper);

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((element: Element) =>
        ({
          getPropertyValue: (name: string) => {
            if (element !== paper) return "";
            if (name === "--background") return "oklch(0.98 0 0)";
            if (name === "--foreground") return "oklch(0.18 0 0)";
            if (name === "--muted-foreground") return "oklch(0.4 0 0)";
            return "";
          },
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 240 120");
    paper.append(svg);

    const markup = bakeSvgForStandalonePreview(svg);
    expect(markup).toContain("--bg:oklch(0.98 0 0)");
    expect(markup).toContain("--fg:oklch(0.18 0 0)");
    expect(markup).toContain('width="240"');
    expect(markup).toContain('height="120"');
    paper.remove();
  });
});
