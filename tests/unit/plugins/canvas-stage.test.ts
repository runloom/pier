/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  canvasFlowMeasureClass,
  detectCanvasStage,
  FLOW_CANVAS_STAGE,
} from "../../../src/plugins/builtin/files/renderer/preview/canvas-stage.ts";

function hostWith(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("detectCanvasStage", () => {
  it("defaults to flow for empty or plain content", () => {
    expect(detectCanvasStage(document.createElement("div"))).toEqual(
      FLOW_CANVAS_STAGE
    );
    expect(
      detectCanvasStage(hostWith("<article><h1>Doc</h1></article>"))
    ).toEqual(FLOW_CANVAS_STAGE);
  });

  it("detects a WorldStage root marker", () => {
    const host = hostWith(
      '<div data-canvas-stage="world"><section>A</section><section>B</section></div>'
    );
    expect(detectCanvasStage(host)).toEqual({
      docs: false,
      fill: false,
      stage: "world",
    });
  });

  it("walks single-child wrappers (boundary divs) to find the root", () => {
    const host = hostWith(
      '<div><div><div data-canvas-stage="world"><p>x</p></div></div></div>'
    );
    expect(detectCanvasStage(host).stage).toBe("world");
  });

  it("ignores a marker nested beside siblings (not the composed root)", () => {
    const host = hostWith(
      '<div><h1>Doc</h1><div data-canvas-stage="world">embedded</div></div>'
    );
    expect(detectCanvasStage(host).stage).toBe("flow");
  });

  it("stops walking beyond the depth budget", () => {
    const deep =
      "<div>".repeat(6) +
      '<div data-canvas-stage="world"></div>' +
      "</div>".repeat(6);
    expect(detectCanvasStage(hostWith(deep)).stage).toBe("flow");
  });

  it("detects a full-bleed flow root via data-canvas-fill", () => {
    const host = hostWith("<div data-canvas-fill><main>app</main></div>");
    expect(detectCanvasStage(host)).toEqual({
      docs: false,
      fill: true,
      stage: "flow",
    });
  });

  it("detects a DocsShell root via data-canvas-docs", () => {
    const host = hostWith(
      "<div data-canvas-docs><nav>toc</nav><main>article</main></div>"
    );
    expect(detectCanvasStage(host)).toEqual({
      docs: true,
      fill: false,
      stage: "flow",
    });
  });

  it("prefers fill over a nested docs marker", () => {
    const host = hostWith(
      "<div data-canvas-fill><div data-canvas-docs>docs</div></div>"
    );
    expect(detectCanvasStage(host)).toEqual({
      docs: false,
      fill: true,
      stage: "flow",
    });
  });
});

describe("canvasFlowMeasureClass", () => {
  it("keeps the reading measure on ordinary flow canvases", () => {
    expect(canvasFlowMeasureClass(FLOW_CANVAS_STAGE)).toContain("max-w-5xl");
    expect(canvasFlowMeasureClass(FLOW_CANVAS_STAGE, "wide")).toContain(
      "max-w-5xl"
    );
  });

  it("drops the measure on fill boards and hands down a definite height", () => {
    // h-full (not just min-h): percentage heights inside the composition
    // must resolve so "single screen, inner scroll" holds.
    expect(
      canvasFlowMeasureClass({ docs: false, fill: true, stage: "flow" })
    ).toBe("h-full min-h-full w-full");
    expect(
      canvasFlowMeasureClass({ docs: false, fill: true, stage: "flow" })
    ).not.toContain("max-w-5xl");
  });

  it("drops the measure on DocsShell wide reading", () => {
    const docs = { docs: true, fill: false, stage: "flow" } as const;
    expect(canvasFlowMeasureClass(docs, "comfortable")).toContain("max-w-5xl");
    expect(canvasFlowMeasureClass(docs, "wide")).not.toContain("max-w-5xl");
  });
});
