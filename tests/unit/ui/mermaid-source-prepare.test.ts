import {
  extractFlowchartEdges,
  isDirectedPath,
  MIN_LINEAR_CHAIN_NODES,
  normalizeMermaidStatements,
  optimizeMermaidSource,
  prepareMermaidSource,
} from "@pier/ui/mermaid/source-prepare.ts";
import { describe, expect, it } from "vitest";

function withAutoTd(source: string): string {
  return ["%%{pier: layout=auto-td}%%", source].join("\n");
}

describe("normalizeMermaidStatements", () => {
  it("splits compact semicolon statements and spaces dense operators", () => {
    expect(normalizeMermaidStatements("graph TD;A-->B")).toBe(
      "graph TD\nA --> B"
    );
  });

  it("expands compact classDiagram bodies that official mermaid rejects", () => {
    expect(
      normalizeMermaidStatements(
        "classDiagram;class A {;+int x;+f();};class B;A --> B"
      )
    ).toBe("classDiagram\nclass A {\n+int x\n+f()\n}\nclass B\nA --> B");
  });

  it("keeps semicolons inside pipe labels", () => {
    expect(normalizeMermaidStatements("graph TD;A-->|ready; retry|B")).toBe(
      "graph TD\nA -->|ready; retry| B"
    );
  });

  it("lets a mid-line comment swallow the rest of the line", () => {
    expect(normalizeMermaidStatements("graph TD;%% hidden;A-->B\nC-->D")).toBe(
      "graph TD\n%% hidden;A-->B\nC --> D"
    );
  });

  it("strips leading comments before the diagram header", () => {
    expect(
      normalizeMermaidStatements("%% model\nclassDiagram;class A {;+int x;}")
    ).toBe("classDiagram\nclass A {\n+int x\n}");
  });

  it("preserves leading %%{init}%% directives for the engine", () => {
    const source = [
      '%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%',
      "flowchart TD",
      "A-->B",
    ].join("\n");
    const normalized = normalizeMermaidStatements(source);
    expect(normalized).toContain("%%{init:");
    expect(normalized).toContain("A --> B");
  });

  it("passes non-flowchart families through apart from statement splits", () => {
    expect(
      normalizeMermaidStatements("erDiagram\nCUSTOMER ||--o{ ORDER : places")
    ).toBe("erDiagram\nCUSTOMER ||--o{ ORDER : places");
    expect(
      normalizeMermaidStatements(
        "sequenceDiagram;participant Alice;participant Bob;Alice-->>Bob: reply"
      )
    ).toBe(
      "sequenceDiagram\nparticipant Alice\nparticipant Bob\nAlice-->>Bob: reply"
    );
  });

  it("keeps quoted arrows and bracket labels verbatim", () => {
    expect(normalizeMermaidStatements('graph TD;A["C-->D"]-->B')).toBe(
      'graph TD\nA["C-->D"] --> B'
    );
    expect(
      normalizeMermaidStatements("graph TD;A[Retry (later]-->B;B-->C")
    ).toBe("graph TD\nA[Retry (later] --> B\nB --> C");
  });

  it("keeps percent signs and %% pairs inside pipe labels", () => {
    expect(
      normalizeMermaidStatements("graph TD;A-->|load 50%%; retry|B;B-->C")
    ).toBe("graph TD\nA -->|load 50%%; retry| B\nB --> C");
  });

  it("spaces bidirectional dotted operators", () => {
    expect(normalizeMermaidStatements("graph TD;A<-.->B")).toBe(
      "graph TD\nA <-.-> B"
    );
  });

  it("keeps unquoted edge text with parentheses intact", () => {
    expect(
      normalizeMermaidStatements("graph TD;A -- retry(later --> B;B-->C")
    ).toBe("graph TD\nA -- retry(later --> B\nB --> C");
  });

  it("splits sequence messages without touching punctuation", () => {
    expect(
      normalizeMermaidStatements(
        "sequenceDiagram;participant A;participant B;A->>B: James' request;B-->>A: done"
      )
    ).toBe(
      "sequenceDiagram\nparticipant A\nparticipant B\nA->>B: James' request\nB-->>A: done"
    );
    expect(
      normalizeMermaidStatements(
        "sequenceDiagram;participant A;participant B;A->>B: retry (later;B-->>A: done"
      )
    ).toBe(
      "sequenceDiagram\nparticipant A\nparticipant B\nA->>B: retry (later\nB-->>A: done"
    );
  });
});

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

describe("prepareMermaidSource", () => {
  it("consumes the pier auto-td directive before it reaches the engine", () => {
    const prepared = prepareMermaidSource(
      withAutoTd(["flowchart LR", "  A-->B-->C-->D-->E-->F-->G-->H"].join("\n"))
    );
    expect(prepared).not.toContain("pier");
    expect(prepared).toContain("flowchart TD");
    expect(prepared).toContain("A --> B");
  });

  it("keeps sources without directives byte-stable apart from spacing", () => {
    expect(prepareMermaidSource("graph TD;A-->B")).toBe("graph TD\nA --> B");
  });
});
