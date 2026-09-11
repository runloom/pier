import { tuneNeoFlowchartMarkers } from "@pier/ui/mermaid/neo-markers.ts";
import { renderMermaid } from "@pier/ui/mermaid/theme.ts";
import { describe, expect, it } from "vitest";
import { installSvgLayoutStubs } from "../../support/svg-layout-stubs.ts";

installSvgLayoutStubs();

describe("tuneNeoFlowchartMarkers", () => {
  it("nudges unused point-margin markers and dash gaps once", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "flowchart");
    svg.innerHTML = `
      <defs>
        <marker id="m-pointStart-margin" refX="1"></marker>
        <marker id="m-pointEnd-margin" refX="11.5"></marker>
      </defs>
      <path class="edge-pattern-solid" data-edge="true" data-look="neo"
        marker-start="url(#m-pointStart-margin)"
        marker-end="url(#m-pointEnd-margin)"
        style="stroke-dasharray: 0 8 100 8"></path>
    `;
    const path = svg.querySelector("path");
    if (path instanceof SVGElement) {
      path.style.strokeDasharray = "0 8 100 8";
    }
    tuneNeoFlowchartMarkers(svg);
    expect(
      svg.querySelector("#m-pointStart-margin")?.getAttribute("refX")
    ).toBe("-3");
    expect(svg.querySelector("#m-pointEnd-margin")?.getAttribute("refX")).toBe(
      "15.5"
    );
    expect(path?.style.strokeDasharray).toBe("0 12 92 12");
    tuneNeoFlowchartMarkers(svg);
    expect(
      svg.querySelector("#m-pointStart-margin")?.getAttribute("refX")
    ).toBe("-3");
  });

  it("does not invent a dash gap on an end with no marker", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "flowchart");
    svg.innerHTML = `
      <defs>
        <marker id="m-pointEnd-margin" refX="11.5"></marker>
      </defs>
      <path class="edge-pattern-solid" data-edge="true" data-look="neo"
        marker-end="url(#m-pointEnd-margin)"
        style="stroke-dasharray: 0 0 100 4"></path>
    `;
    const path = svg.querySelector("path");
    if (path instanceof SVGElement) {
      path.style.strokeDasharray = "0 0 100 4";
    }
    tuneNeoFlowchartMarkers(svg);
    expect(path?.style.strokeDasharray).toBe("0 0 96 8");
    expect(svg.querySelector("#m-pointEnd-margin")?.getAttribute("refX")).toBe(
      "15.5"
    );
  });

  it("only retunes point-margin ends on a rendered neo A-->B edge", async () => {
    const result = await renderMermaid(
      "mm-neo-end-only",
      "flowchart TD\nA-->B"
    );
    const host = document.createElement("div");
    host.innerHTML = result.svg;
    const svg = host.querySelector("svg");
    if (!svg) {
      throw new Error("expected svg");
    }
    const path = svg.querySelector(
      'path[data-edge][data-look="neo"].edge-pattern-solid'
    );
    expect(path).toBeTruthy();
    if (!(path instanceof Element)) {
      throw new Error("expected path");
    }
    const dashes = (path.getAttribute("style") ?? "")
      .match(/stroke-dasharray:\s*([^;]+)/iu)?.[1]
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (path instanceof SVGElement && dashes?.length === 4) {
      path.style.strokeDasharray = dashes.join(" ");
    }
    const before = path instanceof SVGElement ? path.style.strokeDasharray : "";
    tuneNeoFlowchartMarkers(svg);
    const after = path instanceof SVGElement ? path.style.strokeDasharray : "";
    expect(path.getAttribute("marker-start")).toBeFalsy();
    expect(path.getAttribute("marker-end")).toMatch(/pointEnd-margin/u);
    if (before) {
      const [a0, a1] = after.split(/[\s,]+/u).map(Number);
      const [b0, b1] = before.split(/[\s,]+/u).map(Number);
      expect(a0).toBe(b0);
      expect(a1).toBe(b1);
    }
  });

  it("ignores classic flowcharts", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "flowchart");
    svg.innerHTML = `<path class="edge-pattern-solid" data-edge="true" data-look="classic"></path>`;
    tuneNeoFlowchartMarkers(svg);
    expect(svg.querySelector("path")?.getAttribute("data-look")).toBe(
      "classic"
    );
  });
});
