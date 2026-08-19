import { SLOT_ATTR } from "@pier/ui/mermaid/model.ts";
import {
  MERMAID_THEME_CSS,
  mermaidFlowchart,
  renderMermaid,
} from "@pier/ui/mermaid/theme.ts";
import { describe, expect, it } from "vitest";
import { installSvgLayoutStubs } from "../../support/svg-layout-stubs.ts";

installSvgLayoutStubs();

describe("Mermaid render", () => {
  it("lets slotted Pier cards keep kind and status colors", () => {
    expect(MERMAID_THEME_CSS).toContain("color: initial !important");
    expect(MERMAID_THEME_CSS).toContain(".pierSlot foreignObject path");
    expect(MERMAID_THEME_CSS).toContain("stroke: currentColor !important");
    expect(MERMAID_THEME_CSS).toContain(
      '[data-slot="button"][data-variant="outline"]'
    );
  });

  it("keeps htmlLabel slots in the flowchart SVG", async () => {
    const source = mermaidFlowchart({
      edges: [{ source: "host", target: "cli" }],
      nodes: [
        { id: "host", kind: "artifact", title: "Host" },
        { id: "cli", kind: "tool", title: "CLI" },
      ],
    });
    const result = await renderMermaid("mm-slot-flow", source);
    expect(result.svg).toContain("foreignObject");
    expect(result.svg).toMatch(new RegExp(`${SLOT_ATTR}=['"]host['"]`));
    expect(result.svg).toMatch(new RegExp(`${SLOT_ATTR}=['"]cli['"]`));
  });

  it("keeps isolated slotted nodes in the SVG", async () => {
    const source = mermaidFlowchart({
      edges: [{ source: "a", target: "b" }],
      nodes: [
        { id: "a", status: "running", title: "编译" },
        { id: "b", status: "success", title: "发布" },
        { id: "c", status: "failed", title: "校验" },
      ],
    });
    const result = await renderMermaid("mm-isolated", source);
    expect(result.svg).toMatch(new RegExp(`${SLOT_ATTR}=['"]c['"]`));
    const host = document.createElement("div");
    host.innerHTML = result.svg;
    const ids = [...host.querySelectorAll(`[${SLOT_ATTR}]`)].map((el) =>
      el.getAttribute(SLOT_ATTR)
    );
    expect(ids).toContain("c");
    expect(ids).toContain("a");
  });

  it.each([
    [
      "sequence",
      `sequenceDiagram
  participant a as Caller
  participant b as Worker
  a->>+ b: ask`,
      "Caller",
    ],
    [
      "class",
      `classDiagram
  direction TB
  class animal["Animal"] {
    +name
    +speak()
  }
  class dog["Dog"] {
    +breed
    +bark()
  }
  animal <|-- dog`,
      "Animal",
    ],
    [
      "er",
      `erDiagram
  客户 {
    string id
  }
  订单 {
    string id
  }
  客户 ||--o{ 订单 : places`,
      "客户",
    ],
    [
      "state",
      `stateDiagram-v2
  [*] --> run
  run: Run
  run --> [*]`,
      "Run",
    ],
    [
      "mindmap",
      `mindmap
  root((画布))
    a[版式]
    b[控件]`,
      "画布",
    ],
  ] as const)("renders native mermaid %s", async (_family, source, marker) => {
    const result = await renderMermaid(`mm-${_family}`, source);
    expect(result.svg).toContain(marker);
  });
});
