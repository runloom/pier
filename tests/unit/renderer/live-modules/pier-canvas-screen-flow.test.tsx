// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCREEN_FLOW_MIN_GUTTER } from "@pier/ui/canvas-workflow/screen-flow.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Artboard,
  Layer,
  WorldStage,
} from "@/lib/live-modules/pier-canvas-artboard.tsx";
import { ScreenFlow } from "@/lib/live-modules/pier-canvas-screen-flow.tsx";
import { ScreenFlowEmptyCard } from "@/lib/live-modules/pier-canvas-screen-flow-chrome.tsx";

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON() {
      return {};
    },
    top,
    width,
    x: left,
    y: top,
  } as DOMRect;
}

function stubRects() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function stub(this: HTMLElement) {
      const stage = this.getAttribute("data-canvas-stage");
      if (stage === "world") {
        return rect(0, 0, 900, 400);
      }
      const artboard = this.closest("[data-artboard-id]");
      const id =
        artboard instanceof HTMLElement
          ? artboard.dataset.artboardId
          : undefined;
      const slot = this.getAttribute("data-slot");
      if (slot === "artboard-frame" && id === "home") {
        return rect(40, 40, 200, 120);
      }
      if (slot === "artboard-frame" && id === "next") {
        return rect(360, 40, 200, 120);
      }
      if (slot === "artboard-frame" && id === "idle") {
        return rect(680, 40, 200, 120);
      }
      if (slot === "artboard-frame" && id === "blocked") {
        return rect(360, 320, 200, 120);
      }
      if (slot === "artboard-caption" && id === "home") {
        return rect(40, 8, 200, 24);
      }
      if (slot === "artboard-caption" && id === "next") {
        return rect(360, 8, 200, 24);
      }
      if (slot === "artboard-caption" && id === "idle") {
        return rect(680, 8, 200, 24);
      }
      if (slot === "artboard-caption" && id === "blocked") {
        return rect(360, 288, 200, 24);
      }
      return rect(0, 0, 0, 0);
    }
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ScreenFlow", () => {
  it("paints host-compiled edges on a world stage", () => {
    stubRects();
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200}>
            <div>Home body</div>
          </Artboard>
        </Layer>
        <Layer x={360} y={40}>
          <Artboard height={120} id="next" title="Next" width={200}>
            <div>Next body</div>
          </Artboard>
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              { from: "home", id: "e-go", label: "Continue", to: "next" },
            ],
            mainPath: ["home", "next"],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    expect(document.querySelector("[data-slot='screen-flow']")).toBeTruthy();
    expect(document.querySelector("[data-screen-flow='invalid']")).toBeNull();
    const stroke = document.querySelector("[data-slot='workflow-edge-stroke']");
    expect(stroke).toBeTruthy();
    expect(stroke).toHaveAttribute("stroke-width", "1.8");
    expect(stroke).not.toHaveAttribute("stroke-dasharray");
    expect(
      document.querySelector("[data-slot='workflow-edge-casing']")
    ).toBeNull();
    expect(
      document.querySelectorAll("[data-canvas-stage='world']").length
    ).toBe(1);
  });

  it("paints Empty when ScreenFlow is not on a world stage", () => {
    render(
      <ScreenFlow
        spec={{
          edges: [{ from: "home", id: "e-go", label: "Go", to: "next" }],
          title: "Go",
        }}
      />
    );
    expect(document.querySelector("[data-screen-flow='invalid']")).toBeTruthy();
    expect(document.querySelector("[data-slot='workflow-edge']")).toBeNull();
  });

  it("paints Empty when an artboard id is missing", () => {
    stubRects();
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200} />
        </Layer>
        <ScreenFlow
          spec={{
            edges: [{ from: "home", id: "e-go", label: "Go", to: "ghost" }],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    expect(document.querySelector("[data-screen-flow='invalid']")).toBeTruthy();
    expect(document.querySelector("[data-slot='workflow-edge']")).toBeNull();
  });

  it("highlights the related artboard group on hover", () => {
    stubRects();
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200}>
            Home
          </Artboard>
        </Layer>
        <Layer x={360} y={40}>
          <Artboard height={120} id="next" title="Next" width={200}>
            Next
          </Artboard>
        </Layer>
        <Layer x={680} y={40}>
          <Artboard height={120} id="idle" title="Idle" width={200}>
            Idle
          </Artboard>
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              { from: "home", id: "e-go", label: "Continue", to: "next" },
            ],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    const home = document.querySelector("[data-artboard-id='home']");
    expect(home).toBeTruthy();
    if (home) {
      fireEvent.pointerOver(home);
    }
    expect(home).toHaveAttribute("data-screen-flow-state", "hot");
    expect(document.querySelector("[data-artboard-id='next']")).toHaveAttribute(
      "data-screen-flow-state",
      "hot"
    );
    expect(
      document.querySelector("[data-slot='workflow-edge']")
    ).toHaveAttribute("data-workflow-state", "hot");
    expect(
      document.querySelector("[data-artboard-id='idle']")
    ).not.toHaveAttribute("data-screen-flow-state", "hot");
    expect(document.querySelector("[data-screen-flow-state='dim']")).toBeNull();
    expect(screen.getByText("Continue")).toBeTruthy();
    fireEvent.pointerOver(
      document.querySelector("[data-canvas-stage='world']") as HTMLElement
    );
    expect(home).toHaveAttribute("data-screen-flow-state", "idle");
    expect(
      document.querySelector("[data-slot='workflow-edge-flow']")
    ).toBeNull();
  });

  it("mounts a flow overlay while a related artboard is hot", () => {
    stubRects();
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200}>
            Home
          </Artboard>
        </Layer>
        <Layer x={360} y={40}>
          <Artboard height={120} id="next" title="Next" width={200}>
            Next
          </Artboard>
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              { from: "home", id: "e-go", label: "Continue", to: "next" },
            ],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    fireEvent.pointerOver(
      document.querySelector("[data-artboard-id='home']") as HTMLElement
    );
    expect(
      document.querySelector("[data-slot='workflow-edge-flow']")
    ).toBeTruthy();
  });

  it("paints Empty when artboard frames overlap", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function stub(this: HTMLElement) {
        const stage = this.getAttribute("data-canvas-stage");
        if (stage === "world") {
          return rect(0, 0, 900, 400);
        }
        const artboard = this.closest("[data-artboard-id]");
        const id =
          artboard instanceof HTMLElement
            ? artboard.dataset.artboardId
            : undefined;
        const slot = this.getAttribute("data-slot");
        if (slot === "artboard-frame" && id === "home") {
          return rect(40, 40, 200, 120);
        }
        if (slot === "artboard-frame" && id === "next") {
          return rect(80, 40, 200, 120);
        }
        if (slot === "artboard-caption") {
          return rect(40, 8, 200, 24);
        }
        return rect(0, 0, 0, 0);
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200} />
        </Layer>
        <Layer x={80} y={40}>
          <Artboard height={120} id="next" title="Next" width={200} />
        </Layer>
        <ScreenFlow
          spec={{
            edges: [{ from: "home", id: "e-go", label: "Go", to: "next" }],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    expect(document.querySelector("[data-screen-flow='invalid']")).toBeTruthy();
    expect(document.querySelector("[data-slot='workflow-edge']")).toBeNull();
  });

  it("paints error hops at the side stroke weight", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function stub(this: HTMLElement) {
        const stage = this.getAttribute("data-canvas-stage");
        if (stage === "world") {
          return rect(0, 0, 900, 600);
        }
        const artboard = this.closest("[data-artboard-id]");
        const id =
          artboard instanceof HTMLElement
            ? artboard.dataset.artboardId
            : undefined;
        const slot = this.getAttribute("data-slot");
        if (slot === "artboard-frame" && id === "next") {
          return rect(360, 40, 300, 120);
        }
        if (slot === "artboard-frame" && id === "blocked") {
          return rect(360, 320, 300, 120);
        }
        if (slot === "artboard-caption" && id === "next") {
          return rect(360, 8, 300, 24);
        }
        if (slot === "artboard-caption" && id === "blocked") {
          return rect(360, 288, 300, 24);
        }
        return rect(0, 0, 0, 0);
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    render(
      <WorldStage padding={0}>
        <Layer x={360} y={40}>
          <Artboard height={120} id="next" title="Next" width={300} />
        </Layer>
        <Layer x={360} y={320}>
          <Artboard height={120} id="blocked" title="Blocked" width={300} />
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              {
                from: "next",
                id: "e-fail",
                label: "Fail",
                role: "error",
                to: "blocked",
              },
            ],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    expect(
      document.querySelector(
        "[data-edge-id='e-fail'] [data-slot='workflow-edge-stroke']"
      )
    ).toHaveAttribute("stroke-width", "1.4");
  });

  it("compiles hop geometry in world pixels when the stage is fit-scaled", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function stub(this: HTMLElement) {
        const stage = this.getAttribute("data-canvas-stage");
        if (stage === "world") {
          return rect(0, 0, 450, 200);
        }
        const artboard = this.closest("[data-artboard-id]");
        const id =
          artboard instanceof HTMLElement
            ? artboard.dataset.artboardId
            : undefined;
        const slot = this.getAttribute("data-slot");
        if (slot === "artboard-frame" && id === "home") {
          return rect(20, 20, 100, 60);
        }
        if (slot === "artboard-frame" && id === "next") {
          return rect(180, 20, 100, 60);
        }
        if (slot === "artboard-caption" && id === "home") {
          return rect(20, 4, 100, 12);
        }
        if (slot === "artboard-caption" && id === "next") {
          return rect(180, 4, 100, 12);
        }
        return rect(0, 0, 0, 0);
      }
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function offset(this: HTMLElement) {
        return this.getAttribute("data-canvas-stage") === "world" ? 900 : 200;
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200} />
        </Layer>
        <Layer x={360} y={40}>
          <Artboard height={120} id="next" title="Next" width={200} />
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              { from: "home", id: "e-go", label: "Continue", to: "next" },
            ],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    const stroke = document.querySelector("[data-slot='workflow-edge-stroke']");
    expect(stroke).toBeTruthy();
    const points = stroke?.getAttribute("points") ?? "";
    const xs = points.split(" ").map((pair) => Number(pair.split(",")[0]));
    expect(Math.max(...xs)).toBeGreaterThan(200);
    const chip = document.querySelector("[data-slot='screen-flow-start']");
    expect(chip).toHaveStyle({ top: "0px" });
    expect(
      document.querySelector("[data-slot='screen-flow-legend']")
    ).toBeTruthy();
  });

  it("keeps strokes behind frames and pointer-events off the overlay svg", () => {
    stubRects();
    render(
      <WorldStage padding={0}>
        <Layer x={40} y={40}>
          <Artboard height={120} id="home" title="Home" width={200}>
            <button type="button">Open</button>
          </Artboard>
        </Layer>
        <Layer x={360} y={40}>
          <Artboard height={120} id="next" title="Next" width={200} />
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              { from: "home", id: "e-go", label: "Continue", to: "next" },
            ],
            title: "Go",
          }}
        />
      </WorldStage>
    );
    const ink = document.querySelector("[data-slot='screen-flow-ink']");
    const labels = document.querySelector("[data-slot='screen-flow-labels']");
    const layer = document.querySelector("[data-slot='canvas-layer']");
    expect(ink).toHaveStyle({ pointerEvents: "none", zIndex: "0" });
    expect(labels).toHaveStyle({ pointerEvents: "none", zIndex: "2" });
    expect(layer).toHaveStyle({ zIndex: "1" });
    expect(
      document.querySelector("[data-slot='workflow-edge-arrow']")
    ).toBeTruthy();
    expect(document.querySelector("[data-slot='screen-flow']")).not.toHaveClass(
      "z-1"
    );
  });

  it("paints the canvas-kit ScreenFlow specimen instead of Empty", () => {
    const kit = readFileSync(
      join(process.cwd(), ".pier/canvases/canvas-kit/layout.tsx"),
      "utf8"
    );
    expect(kit).toContain("ScreenFlow");
    expect(kit).toContain(`x={${8 + 72 + SCREEN_FLOW_MIN_GUTTER}}`);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function stub(this: HTMLElement) {
        const stage = this.getAttribute("data-canvas-stage");
        if (stage === "world") {
          return rect(0, 0, 400, 200);
        }
        const artboard = this.closest("[data-artboard-id]");
        const id =
          artboard instanceof HTMLElement
            ? artboard.dataset.artboardId
            : undefined;
        const slot = this.getAttribute("data-slot");
        if (slot === "artboard-frame" && id === "kitHome") {
          return rect(8, 40, 72, 48);
        }
        if (slot === "artboard-frame" && id === "kitNext") {
          return rect(8 + 72 + SCREEN_FLOW_MIN_GUTTER, 40, 72, 48);
        }
        if (slot === "artboard-caption" && id === "kitHome") {
          return rect(8, 8, 72, 24);
        }
        if (slot === "artboard-caption" && id === "kitNext") {
          return rect(8 + 72 + SCREEN_FLOW_MIN_GUTTER, 8, 72, 24);
        }
        return rect(0, 0, 0, 0);
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    render(
      <WorldStage padding={8}>
        <Layer x={8} y={8}>
          <Artboard height={48} id="kitHome" title="A" width={72} />
        </Layer>
        <Layer x={8 + 72 + SCREEN_FLOW_MIN_GUTTER} y={8}>
          <Artboard height={48} id="kitNext" title="B" width={72} />
        </Layer>
        <ScreenFlow
          spec={{
            edges: [
              { from: "kitHome", id: "eKit", label: "Next", to: "kitNext" },
            ],
            title: "Path",
          }}
        />
      </WorldStage>
    );
    expect(document.querySelector("[data-screen-flow='invalid']")).toBeNull();
    expect(document.querySelector("[data-slot='workflow-edge']")).toBeTruthy();
  });

  it("maps through-box Empty to the product sentence, not other quality codes", () => {
    const { unmount } = render(
      <ScreenFlowEmptyCard
        diagnostics={[
          {
            code: "workflow/edge-crosses-node",
            message: "Edge e-x crosses a node.",
            supportedFixes: ["Move the Layer of mid."],
          },
        ]}
      />
    );
    expect(
      screen.getByText("A connector crosses another screen. Move one of them.")
    ).toBeTruthy();
    unmount();
    render(
      <ScreenFlowEmptyCard
        diagnostics={[
          {
            code: "workflow/last-segment-short",
            message: "Edge e-x last segment is too short for the arrow.",
            supportedFixes: ["Move an endpoint."],
          },
        ]}
      />
    );
    expect(
      screen.queryByText(
        "A connector crosses another screen. Move one of them."
      )
    ).toBeNull();
  });
});
