import { renderMermaid } from "@pier/ui/mermaid/theme.ts";
import { MERMAID_THEME_CSS } from "@pier/ui/mermaid/theme-css.ts";
import { describe, expect, it } from "vitest";
import { installSvgLayoutStubs } from "../../support/svg-layout-stubs.ts";

installSvgLayoutStubs();

function svgCss(svg: string): string {
  return svg.replaceAll("&gt;", ">").replaceAll("&quot;", '"');
}

describe("mermaid closed-set paper tokens", () => {
  it("paints flowchart subgraphs with the grouping token", async () => {
    const result = await renderMermaid(
      "mm-cluster-paper",
      `flowchart TB
  subgraph g1 [Group]
    a[A]
    b[B]
  end
  a --> b`
    );
    const css = svgCss(result.svg);
    expect(css).toContain(".cluster rect");
    expect(css).toMatch(/fill:\s*var\(--secondary\)/);
    expect(css).toContain(".cluster-label");
    const host = document.createElement("div");
    host.innerHTML = result.svg;
    expect(host.querySelector(".cluster rect")).toBeTruthy();
    expect(host.querySelector('[data-look="neo"]')).toBeTruthy();
    expect(result.svg).toContain("pointEnd");
  });

  it("covers ellipse and path node silhouettes in the overlay", () => {
    expect(MERMAID_THEME_CSS).toContain(".node ellipse");
    expect(MERMAID_THEME_CSS).toContain(".node path");
  });

  it("paints ER entity boxes and keeps crow-foot markers hollow", async () => {
    const result = await renderMermaid(
      "mm-er-paper",
      `erDiagram
  客户 {
    string id
  }
  订单 {
    string id
  }
  客户 ||--o{ 订单 : places`
    );
    const css = svgCss(result.svg);
    expect(css).toContain(".entityBox");
    expect(css).toContain(".relationshipLine");
    expect(css).toContain(".onlyOne");
    expect(css).toContain(".zeroOrOne");
    expect(css).toMatch(
      /\.onlyOne[^{]*\{fill:none|\.zeroOrOne[^{]*\{fill:none/
    );
    expect(css).not.toMatch(/\.marker path[^{]*\{fill:none/);
    expect(css).toMatch(/\.entityBox[^{]*\{fill:var\(--card\)/);
    const host = document.createElement("div");
    host.innerHTML = result.svg;
    // Attribute rows render as g.node, not .entityBox; both selectors are
    // in the overlay so either silhouette still gets --card.
    expect(host.querySelector(".node")).toBeTruthy();
  });

  it("paints class inheritance markers hollow", async () => {
    const inherit = await renderMermaid(
      "mm-class-paper",
      `classDiagram
  direction TB
  class animal["Animal"]
  class dog["Dog"]
  animal <|-- dog`
    );
    const css = svgCss(inherit.svg);
    expect(css).toContain(".extension");
    expect(css).toMatch(/\.extension[^{]*\{fill:none/);
    expect(css).toContain("g.classGroup text");
    const composed = await renderMermaid(
      "mm-class-compose",
      `classDiagram
  direction TB
  class animal["Animal"]
  class dog["Dog"]
  animal *-- dog`
    );
    expect(svgCss(composed.svg)).toMatch(
      /\.composition[^{]*\{fill:var\(--muted-foreground\)/
    );
  });

  it("paints state composite inners and notes onto grouping tokens", async () => {
    const result = await renderMermaid(
      "mm-state-paper",
      `stateDiagram-v2
  [*] --> run
  state run {
    [*] --> inner
    inner --> [*]
  }
  note right of run: parked
  run --> [*]`
    );
    const css = svgCss(result.svg);
    expect(css).toContain(".statediagram-cluster .inner");
    expect(css).toContain(".statediagram-note rect");
    expect(css).toMatch(/fill:\s*var\(--secondary\)/);
    expect(css).toContain(".node circle.state-start");
    expect(css).toMatch(
      /\.node circle\.state-end[^{}]*\{[^}]*stroke:\s*var\(--foreground\)/
    );
  });

  it("paints mindmap sections onto card instead of cScale pastels", async () => {
    const result = await renderMermaid(
      "mm-mindmap-paper",
      `mindmap
  root((画布))
    a[版式]
    b[控件]`
    );
    const css = svgCss(result.svg);
    expect(css).toContain(".mindmap-node path");
    expect(css).toContain('[class^="section-edge-"]');
    expect(css).toMatch(/fill:\s*var\(--card\)/);
  });

  it("still lets author classDef fill win after the overlay", async () => {
    const result = await renderMermaid(
      "mm-classdef-paper",
      `flowchart TB
  a[A]
  classDef hot fill:#ff0000,stroke:#aa0000,color:#fff
  class a hot`
    );
    const css = svgCss(result.svg);
    expect(css).toContain(".cluster rect");
    expect(css).toMatch(/#ff0000/i);
    const host = document.createElement("div");
    host.innerHTML = result.svg;
    const hot = host.querySelector(".hot");
    const shape = hot?.querySelector("rect, polygon, path, circle");
    expect(shape?.getAttribute("style") ?? "").toMatch(/fill:\s*#ff0000/i);
  });

  it("keeps neo point barbs filled after the overlay", async () => {
    const result = await renderMermaid(
      "mm-neo-barb-fill",
      `flowchart TD
  A-->B`
    );
    const css = svgCss(result.svg);
    expect(css).toMatch(
      /\.arrowMarkerPath[^{]*\{fill:var\(--muted-foreground\)/
    );
    expect(css).not.toMatch(/\.marker path[^{]*\{fill:none/);
    const host = document.createElement("div");
    host.innerHTML = result.svg;
    const barb = host.querySelector(".arrowMarkerPath");
    expect(barb).toBeTruthy();
    expect(barb?.tagName.toLowerCase()).toMatch(/path|polygon/);
  });
});
