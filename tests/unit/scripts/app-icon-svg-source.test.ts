import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PIER_BRAND_PALETTE } from "../../../src/renderer/lib/theme/pierre-brand-overlay.ts";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "build/app-icon-source.svg");

function parseSource(): Document {
  const source = readFileSync(SOURCE, "utf8");
  return new DOMParser().parseFromString(source, "image/svg+xml");
}

function gradientColors(document: Document, selector: string): string[] {
  return Array.from(document.querySelectorAll(`${selector} stop`)).map(
    (stop) => stop.getAttribute("stop-color") ?? ""
  );
}

describe("Pier minimal vector app-icon source", () => {
  it("provides one parseable 1024px SVG source", () => {
    expect(existsSync(SOURCE)).toBe(true);
    if (!existsSync(SOURCE)) {
      return;
    }

    const document = parseSource();
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.tagName).toBe("svg");
    expect(document.documentElement.getAttribute("viewBox")).toBe(
      "0 0 1024 1024"
    );
  });

  it("keeps the full-bleed canvas and prompt plus berth geometry", () => {
    if (!existsSync(SOURCE)) {
      return;
    }

    const document = parseSource();
    const body = document.querySelector("#pier-body");
    expect(body?.getAttribute("x")).toBe("0");
    expect(body?.getAttribute("y")).toBe("0");
    expect(body?.getAttribute("width")).toBe("1024");
    expect(body?.getAttribute("height")).toBe("1024");
    expect(body?.getAttribute("rx")).toBe(null);
    expect(document.querySelector("#pier-body-clip")).toBeNull();
    expect(document.querySelector("#pier-edge-rim")).toBeNull();
    expect(
      document.querySelector("#pier-artwork")?.getAttribute("transform")
    ).toBe(null);
    expect(document.querySelector("#pier-chevron")?.getAttribute("d")).toBe(
      "M337 223 L522 405 L337 599"
    );
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("stroke")
    ).toBe("#ffffff");
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("stroke-width")
    ).toBe("104");
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("stroke-linecap")
    ).toBe("round");
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("stroke-linejoin")
    ).toBe("round");
    expect(document.querySelector("#pier-underscore")?.getAttribute("d")).toBe(
      "M547 612 H770"
    );
    expect(
      document.querySelector("#pier-underscore")?.getAttribute("stroke")
    ).toBe("#ffffff");
    expect(
      document.querySelector("#pier-underscore")?.getAttribute("stroke-width")
    ).toBe("80");
    expect(
      document.querySelector("#pier-underscore")?.getAttribute("stroke-linecap")
    ).toBe("round");
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("transform")
    ).toBe(null);
    expect(
      document.querySelector("#pier-underscore")?.getAttribute("transform")
    ).toBe(null);
    expect(
      document.querySelector("#pier-prompt")?.getAttribute("transform")
    ).toBe("translate(512 440) scale(0.86) translate(-547.5 -411.5)");
    expect(document.querySelector("#pier-berth")?.getAttribute("d")).toBe(
      "M0 664 H64 C176 664 180 850 320 850 H704 C844 850 848 664 960 664 H1024 V1024 H0 Z"
    );
    expect(document.querySelector("#pier-berth")?.getAttribute("fill")).toBe(
      "url(#pier-violet)"
    );
  });

  it("does not bake a rounded container, inset transform, or inner edge rim", () => {
    if (!existsSync(SOURCE)) {
      return;
    }

    const source = readFileSync(SOURCE, "utf8");
    const document = parseSource();
    expect(document.querySelector("#pier-body-clip")).toBeNull();
    expect(document.querySelector("#pier-edge")).toBeNull();
    expect(document.querySelector("#pier-edge-rim")).toBeNull();
    expect(source).not.toContain("translate(102 102)");
    expect(source).not.toContain("scale(0.80078125)");
    expect(document.querySelector("#pier-body")?.getAttribute("rx")).toBe(null);
  });

  it("uses one self-contained shared micro-relief material for prompt and berth", () => {
    if (!existsSync(SOURCE)) {
      return;
    }

    const source = readFileSync(SOURCE, "utf8");
    const document = parseSource();
    const filters = document.querySelectorAll("filter");
    expect(filters).toHaveLength(1);
    expect(filters[0]?.getAttribute("id")).toBe("pier-relief");
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("filter")
    ).toBe(null);
    expect(
      document.querySelector("#pier-underscore")?.getAttribute("filter")
    ).toBe(null);
    expect(
      document.querySelector("#pier-berth-relief")?.getAttribute("filter")
    ).toBe("url(#pier-relief)");
    expect(document.querySelector("#pier-berth")?.getAttribute("filter")).toBe(
      null
    );

    const berthSeamGuard = document.querySelector("#pier-berth-seam-guard");
    expect(berthSeamGuard?.getAttribute("x")).toBe("0");
    expect(berthSeamGuard?.getAttribute("y")).toBe("1008");
    expect(berthSeamGuard?.getAttribute("width")).toBe("1024");
    expect(berthSeamGuard?.getAttribute("height")).toBe("64");
    expect(berthSeamGuard?.getAttribute("fill")).toBe("url(#pier-violet)");

    const violetOffsets = Array.from(
      document.querySelectorAll("#pier-violet stop")
    ).map((stop) => stop.getAttribute("offset"));
    expect(violetOffsets).toEqual(["0%", "46%", "100%"]);
    expect(document.querySelector("#pier-blue")).toBeNull();
    expect(source).not.toMatch(/url\(\s*["']?(?!#)/i);
    expect(source).not.toMatch(/<(?:image|script)\b|@import|\bfont-/i);
    expect(source).not.toMatch(/\b(?:href|xlink:href)\s*=/i);
  });

  it("uses a white prompt and a metallic brand-violet berth", () => {
    if (!existsSync(SOURCE)) {
      return;
    }

    const document = parseSource();
    expect(gradientColors(document, "#pier-violet")).toEqual([
      PIER_BRAND_PALETTE.highlight,
      PIER_BRAND_PALETTE.primary,
      PIER_BRAND_PALETTE.deep,
    ]);
    expect(gradientColors(document, "#pier-body-fill")).toEqual([
      "#1e2430",
      "#141820",
      "#0c1016",
    ]);
    expect(document.querySelector("#pier-metal-sheen-layer")).toBeNull();
    expect(document.querySelector("#pier-chevron-ridge")).toBeNull();
    expect(document.querySelector("#pier-underscore-ridge")).toBeNull();
    expect(document.querySelector("#pier-berth-spec")).toBeNull();
    expect(document.querySelector("#pier-ping-left")).not.toBeNull();
    expect(document.querySelector("#pier-ping-right")).not.toBeNull();
    expect(document.querySelector("#pier-berth-rim")?.getAttribute("d")).toBe(
      "M88 682 C186 682 196 868 328 868 H696 C828 868 838 682 936 682"
    );
    expect(
      document.querySelector("#pier-berth-rim")?.getAttribute("stroke-linecap")
    ).toBe("round");
    expect(document.querySelector("#pier-berth-clip path")).not.toBeNull();
    expect(
      document.querySelector("#pier-chevron")?.getAttribute("stroke")
    ).toBe("#ffffff");
    expect(
      document.querySelector("#pier-underscore")?.getAttribute("stroke")
    ).toBe("#ffffff");
    expect(document.querySelector("#pier-berth")?.getAttribute("fill")).toBe(
      "url(#pier-violet)"
    );
    expect(document.querySelector("#pier-edge-rim")).toBeNull();
  });

  it("keeps berth metal shine low-frequency so small sizes do not form two hotspots", () => {
    if (!existsSync(SOURCE)) {
      return;
    }

    const document = parseSource();
    const leftPing = document.querySelector("#pier-ping-left");
    const rightPing = document.querySelector("#pier-ping-right");
    expect(leftPing?.getAttribute("r")).toBe("180");
    expect(rightPing?.getAttribute("r")).toBe("180");
    expect(
      Array.from(leftPing?.querySelectorAll("stop") ?? []).map((stop) =>
        stop.getAttribute("stop-opacity")
      )
    ).toEqual(["0.22", "0.10", "0"]);
    expect(
      Array.from(rightPing?.querySelectorAll("stop") ?? []).map((stop) =>
        stop.getAttribute("stop-opacity")
      )
    ).toEqual(["0.22", "0.10", "0"]);

    const rim = document.querySelector("#pier-rim");
    expect(rim?.getAttribute("x1")).toBe("512");
    expect(rim?.getAttribute("x2")).toBe("512");
    expect(rim?.getAttribute("y1")).toBe("682");
    expect(rim?.getAttribute("y2")).toBe("868");
    expect(
      Array.from(rim?.querySelectorAll("stop") ?? []).map((stop) =>
        stop.getAttribute("stop-opacity")
      )
    ).toEqual(["0.32", "0.14", "0.04"]);
  });

  it("keeps the outer contour crisp with a shared internal micro-bevel", () => {
    if (!existsSync(SOURCE)) {
      return;
    }

    const document = parseSource();
    const filter = document.querySelector("#pier-relief");
    expect(filter?.querySelectorAll("feGaussianBlur")).toHaveLength(2);
    expect(filter?.querySelectorAll("feOffset")).toHaveLength(2);
    expect(filter?.querySelectorAll("feFlood")).toHaveLength(2);
    expect(filter?.querySelectorAll("feMergeNode")).toHaveLength(3);
    expect(filter?.querySelector("feDropShadow")).toBeNull();
    expect(
      Array.from(filter?.querySelectorAll("feGaussianBlur") ?? []).map((node) =>
        node.getAttribute("stdDeviation")
      )
    ).toEqual(["1.25", "1.75"]);
    expect(
      Array.from(filter?.querySelectorAll("feOffset") ?? []).map((node) => [
        node.getAttribute("dx"),
        node.getAttribute("dy"),
      ])
    ).toEqual([
      ["0", "6"],
      ["0", "-8"],
    ]);
    expect(
      Array.from(filter?.querySelectorAll("feFlood") ?? []).map((node) =>
        node.getAttribute("flood-opacity")
      )
    ).toEqual(["0.28", "0.34"]);

    const internalBands = Array.from(
      filter?.querySelectorAll('feComposite[operator="out"]') ?? []
    );
    expect(internalBands).toHaveLength(2);
    expect(
      internalBands.map((node) => [
        node.getAttribute("in"),
        node.getAttribute("in2"),
      ])
    ).toEqual([
      ["SourceAlpha", "top-shift"],
      ["SourceAlpha", "bottom-shift"],
    ]);

    const clippedFacets = Array.from(
      filter?.querySelectorAll(
        'feComposite[in2="SourceAlpha"][operator="in"]'
      ) ?? []
    );
    expect(clippedFacets.map((node) => node.getAttribute("result"))).toEqual([
      "top-highlight",
      "bottom-shadow",
    ]);
    expect(
      clippedFacets.map((node) => [
        node.getAttribute("in"),
        node.getAttribute("result"),
      ])
    ).toEqual([
      ["top-tint", "top-highlight"],
      ["bottom-tint", "bottom-shadow"],
    ]);
    expect(
      Array.from(filter?.querySelectorAll("feMergeNode") ?? []).map((node) =>
        node.getAttribute("in")
      )
    ).toEqual(["SourceGraphic", "top-highlight", "bottom-shadow"]);
  });

  it("does not retain alternate optical SVG sources", () => {
    for (const path of [
      "build/app-icon.svg",
      "build/app-icon-16.svg",
      "build/app-icon-master.svg",
      "build/app-icon-small.svg",
      "build/app-icon-tiny.svg",
      "build/app-icon-micro.svg",
      "build/app-icon-unplated.svg",
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    }
  });
});
