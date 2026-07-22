import { bakeMermaidSvgForStandalonePreview } from "@plugins/builtin/files/renderer/markdown-diagram.tsx";
import { describe, expect, it, vi } from "vitest";

describe("bakeMermaidSvgForStandalonePreview", () => {
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
    const markup = bakeMermaidSvgForStandalonePreview(svg);
    expect(markup).toContain("--bg:oklch(1 0 0)");
    expect(markup).toContain("--fg:oklch(0.2 0 0)");
    expect(markup).toContain("--border:color-mix(in srgb, oklch(0.2 0 0) 22%");
    expect(markup).toContain("--line:color-mix(in srgb, oklch(0.2 0 0) 45%");
    expect(markup).toContain("--accent:color-mix(in srgb, oklch(0.2 0 0) 45%");
    expect(markup).not.toMatch(/--border:var\(--border\)/);
  });
});
