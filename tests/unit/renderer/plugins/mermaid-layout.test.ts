import { describe, expect, it } from "vitest";
import {
  extractFlowchartEdges,
  isDirectedPath,
  MIN_LINEAR_CHAIN_NODES,
  optimizeMermaidSource,
} from "@/lib/plugins/mermaid/layout.ts";
import { renderMermaidInWorker } from "@/lib/plugins/mermaid/render.worker.ts";

function withAutoTd(source: string): string {
  return ["%%{pier: layout=auto-td}%%", source].join("\n");
}

describe("optimizeMermaidSource", () => {
  it("does not rewrite by default (opt-in only)", () => {
    const source = ["flowchart LR", "  A-->B-->C-->D-->E-->F-->G-->H"].join(
      "\n"
    );
    expect(optimizeMermaidSource(source).rewroteDirection).toBe(false);
  });

  it("rewrites long LR linear chains to TD when auto-td is set", () => {
    const source = withAutoTd(
      ["flowchart LR", "  A-->B-->C-->D-->E-->F-->G-->H"].join("\n")
    );
    const result = optimizeMermaidSource(source);
    expect(result.rewroteDirection).toBe(true);
    expect(result.source).toMatch(/flowchart TD/u);
    expect(result.source).toContain("A-->B-->C-->D-->E-->F-->G-->H");
  });

  it("rewrites graph RL path chains to TD when auto-td is set", () => {
    const source = withAutoTd("graph RL; N1-->N2-->N3-->N4-->N5-->N6");
    const result = optimizeMermaidSource(source);
    expect(result.rewroteDirection).toBe(true);
    expect(result.source).toMatch(/graph TD/u);
  });

  it("leaves short chains and TD diagrams unchanged even with auto-td", () => {
    expect(
      optimizeMermaidSource(withAutoTd("flowchart LR\n  A-->B-->C"))
        .rewroteDirection
    ).toBe(false);
    expect(
      optimizeMermaidSource(
        withAutoTd("flowchart TD\n  A-->B-->C-->D-->E-->F-->G")
      ).rewroteDirection
    ).toBe(false);
  });

  it("does not rewrite branched graphs", () => {
    const source = withAutoTd(
      ["flowchart LR", "  A-->B-->C-->D-->E-->F", "  B-->X"].join("\n")
    );
    expect(optimizeMermaidSource(source).rewroteDirection).toBe(false);
  });

  it("does not rewrite diagrams with subgraphs", () => {
    const source = withAutoTd(
      [
        "flowchart LR",
        "  subgraph S",
        "    A-->B-->C-->D-->E-->F",
        "  end",
      ].join("\n")
    );
    expect(optimizeMermaidSource(source).rewroteDirection).toBe(false);
  });

  it("respects layout=keep over auto-td", () => {
    const source = [
      "%%{pier: layout=keep}%%",
      "%%{pier: layout=auto-td}%%",
      "flowchart LR",
      "  A-->B-->C-->D-->E-->F-->G",
    ].join("\n");
    expect(optimizeMermaidSource(source).rewroteDirection).toBe(false);
  });

  it("handles labeled nodes and edge labels on a path", () => {
    const source = withAutoTd(
      [
        "flowchart LR",
        '  A["one"] -->|go| B["two"] --> C --> D --> E --> F',
      ].join("\n")
    );
    const result = optimizeMermaidSource(source);
    expect(result.rewroteDirection).toBe(true);
    expect(result.source).toMatch(/flowchart TD/u);
  });
});

describe("extractFlowchartEdges / isDirectedPath", () => {
  it("extracts multi-hop edges from one statement", () => {
    expect(extractFlowchartEdges("A-->B-->C-->D")).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
    ]);
  });

  it("requires a single directed path of enough nodes", () => {
    const path = extractFlowchartEdges("A-->B-->C-->D-->E-->F");
    expect(isDirectedPath(path, MIN_LINEAR_CHAIN_NODES)).toBe(true);
    expect(isDirectedPath(path, 7)).toBe(false);

    const branch = extractFlowchartEdges("A-->B-->C\nB-->X");
    expect(isDirectedPath(branch, 3)).toBe(false);
  });
});

describe("renderMermaidInWorker respects source direction", () => {
  it("does not auto-rewrite LR chains in the default render path", () => {
    const source = ["flowchart LR", "  A-->B-->C-->D-->E-->F-->G-->H"].join(
      "\n"
    );
    const svg = renderMermaidInWorker({ source });
    const size = svgViewportSize(svg);
    expect(size).not.toBeNull();
    if (!size) return;
    // Default path keeps LR: wide aspect for an 8-node path.
    expect(size.width).toBeGreaterThan(size.height);
  });

  it("rewrites LR path chains when layout=auto-td is set", () => {
    const source = [
      "%%{pier: layout=auto-td}%%",
      "flowchart LR",
      "  A-->B-->C-->D-->E-->F-->G-->H",
    ].join("\n");
    const svg = renderMermaidInWorker({ source });
    const size = svgViewportSize(svg);
    expect(size).not.toBeNull();
    if (!size) return;
    expect(size.height).toBeGreaterThan(size.width);
  });
});

function svgViewportSize(
  svg: string
): { height: number; width: number } | null {
  const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1];
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return { height: parts[3] ?? 0, width: parts[2] ?? 0 };
    }
  }
  const width = Number(/width="([\d.]+)"/u.exec(svg)?.[1]);
  const height = Number(/height="([\d.]+)"/u.exec(svg)?.[1]);
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { height, width };
  }
  return null;
}
