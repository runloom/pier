import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("paints default flowchart nodes with card fill and mixed connectors", async () => {
    const source = await readFile(
      join(import.meta.dirname, "../../../packages/ui/src/mermaid/theme.ts"),
      "utf8"
    );
    expect(MERMAID_THEME_CSS).toContain(
      "stroke: color-mix(in srgb, var(--foreground) 45%, var(--background)) !important;"
    );
    expect(MERMAID_THEME_CSS).toMatch(
      /\.node rect, \.node polygon, \.node circle, \.node \.label-container, \.node \.basic \{\s*fill: var\(--card\) !important;\s*stroke: var\(--border\) !important;/
    );
    expect(MERMAID_THEME_CSS).not.toContain("max-width: 100%");
    expect(source).toContain("useMaxWidth: false");
  });

  it("routes the markdown/plugin facade through the same official engine", async () => {
    // Single-engine convergence: the charts facade (markdown inline, plugin
    // charts) must render via this module's renderMermaid with the shared
    // source-prepare pass, not a second engine. Fullscreen re-renders the
    // same prepared source, so inline and fullscreen stay identical.
    const facade = await readFile(
      join(
        import.meta.dirname,
        "../../../src/renderer/lib/plugins/mermaid/renderer.ts"
      ),
      "utf8"
    );
    expect(facade).toContain('from "@pier/ui/mermaid/theme.ts"');
    expect(facade).toContain('from "@pier/ui/mermaid/source-prepare.ts"');
    expect(facade).not.toContain("Worker");
    expect(facade).not.toContain("beautiful-mermaid");
    // Diagram text follows the UI font everywhere (never the markdown
    // reading/paper font).
    expect(MERMAID_THEME_CSS).toContain("font-family: var(--font-sans)");
  });

  it("neutralizes mermaid edge-label pill backgrounds on every layer", () => {
    // mermaid base theme emits ".edgeLabel p { background-color: hsl(…) }"
    // and ".edgeLabel rect { fill: hsl(…); opacity: .5 }" — without these
    // overrides labels render as pink pills with foreground text.
    expect(MERMAID_THEME_CSS).toContain(".edgeLabel, .labelBkg, .edgeLabel p");
    expect(MERMAID_THEME_CSS).toContain(".edgeLabel rect");
  });

  it("paints sequence notes and alt labels onto tspans, not just parents", () => {
    // mermaid sequence CSS is `.noteText, .noteText > tspan { fill: <light-theme gray> }`.
    // Parent `fill: var(--foreground) !important` does not inherit onto the
    // child tspan, so notes / alt conditions vanish on the dark canvas.
    expect(MERMAID_THEME_CSS).toContain(".noteText > tspan");
    expect(MERMAID_THEME_CSS).toContain(".loopText > tspan");
    expect(MERMAID_THEME_CSS).toContain(".labelText > tspan");
    expect(MERMAID_THEME_CSS).toContain("text.actor > tspan");
    expect(MERMAID_THEME_CSS).toContain(".note, .labelBox, rect.actor");
    expect(MERMAID_THEME_CSS).toMatch(
      /\.note, \.labelBox, rect\.actor \{[\s\S]*fill: var\(--secondary\)/
    );
    expect(MERMAID_THEME_CSS).not.toMatch(
      /\.note \{[\s\S]*fill: var\(--muted\)/
    );
  });

  it("does not nest backticks inside the mermaid theme CSS template", async () => {
    const source = await readFile(
      join(import.meta.dirname, "../../../packages/ui/src/mermaid/theme.ts"),
      "utf8"
    );
    const prefix = "export const MERMAID_THEME_CSS = `";
    const start = source.indexOf(prefix);
    const end = source.indexOf("`;", start + prefix.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start + prefix.length, end)).not.toContain("`");
  });

  it("beats mermaid id-scoped span color on hydrated card roles", async () => {
    // mermaid emits "#<renderId> span { color: #333 }" and global
    // ".label text,span,p" fill/color. Title/meta are divs (not spans) so
    // those rules miss; important tokens still win if a wrapper matches.
    const source = await readFile(
      join(import.meta.dirname, "../../../packages/ui/src/mermaid/mark.tsx"),
      "utf8"
    );
    expect(source).toContain("text-card-foreground!");
    expect(source).toContain("text-muted-foreground!");
    expect(source).toContain("leading-5!");
    expect(source).toContain("leading-4!");
    expect(source).toContain("font-medium");
    expect(source).toContain("text-sm");
    expect(source).toContain("break-words");
    expect(source).toContain("text-xs");
    expect(source).toContain(
      'className="min-w-0 whitespace-normal break-words font-medium text-card-foreground! text-sm leading-5!"'
    );
    expect(source).toContain("min-h-full");
    expect(source).toContain("justify-start");
    expect(source).toContain("data-mermaid-wash");
    expect(source).not.toContain("justify-center");
  });

  it("fills slotted mermaid cards from the top without clipping the wash", () => {
    expect(MERMAID_THEME_CSS).toContain(".pierSlot .nodeLabel p");
    expect(MERMAID_THEME_CSS).toContain("font-size: 0 !important");
    expect(MERMAID_THEME_CSS).toContain("vertical-align: top !important");
    expect(MERMAID_THEME_CSS).toContain("overflow: visible !important");
    expect(MERMAID_THEME_CSS).not.toContain("line-height: 0 !important");
    expect(MERMAID_THEME_CSS).toContain(`.pierSlot .nodeLabel [${SLOT_ATTR}]`);
    expect(MERMAID_THEME_CSS).not.toMatch(
      /\.pierSlot foreignObject[\s\S]{0,200}overflow: hidden/
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

  it("keeps sequence note and alt tspan overrides in the compiled SVG", async () => {
    const result = await renderMermaid(
      "mm-seq-contrast",
      `sequenceDiagram
  participant a as Host
  participant b as Phone
  Note over a: local listen only
  alt no token
      a->>b: pair
  else has token
      b->>a: hello
  end`
    );
    expect(result.svg).toContain("noteText");
    expect(result.svg).toContain("loopText");
    // stylis nests themeCSS under the svg id and serializes `>` as `&gt;`.
    const css = result.svg.replaceAll("&gt;", ">");
    expect(css).toContain(".noteText>tspan");
    expect(css).toContain("fill:var(--secondary)!important");
    expect(css).toContain("fill:var(--foreground)!important");
  });
});
