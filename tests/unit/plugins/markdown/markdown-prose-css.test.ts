import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(
    import.meta.dirname,
    "../../../../src/plugins/builtin/files/renderer/markdown/prose.css"
  ),
  "utf8"
);

/** Extract a CSS rule body by selector substring (order-agnostic asserts). */
function ruleBody(selectorFragment: string): string {
  const index = css.indexOf(selectorFragment);
  expect(
    index,
    `selector not found: ${selectorFragment}`
  ).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("markdown prose comfortable measure wrapping", () => {
  it("breaks long tokens at the measure instead of stretching the column", () => {
    const proseBody = ruleBody('[data-slot="markdown-prose"] {');
    expect(proseBody).toContain("max-width: var(--md-measure)");
    expect(proseBody).toContain("--md-measure-comfortable: 42rem");
    expect(proseBody).toContain("overflow-wrap: anywhere");
    expect(proseBody).toContain("text-align: start");
    expect(proseBody).toContain("text-wrap: wrap");
    expect(proseBody).not.toContain("85ch");
    expect(ruleBody(".md-inline-code")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".md-footnote-popover {")).toContain(
      "overflow-wrap: anywhere"
    );
  });

  it("keeps list grid tracks shrinkable so unbreakable code cannot expand them", () => {
    const listBody = ruleBody(".md-ul,");
    expect(listBody).toContain("display: grid");
    expect(listBody).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(listBody).toContain("padding-inline-end: 0");
    expect(listBody).toContain("text-wrap: wrap");
    expect(ruleBody(".md-blockquote")).toContain("padding-inline-end: 0");
    expect(ruleBody(".md-li {")).toContain("min-width: 0");
    expect(ruleBody(".md-li-task")).toContain("min-width: 0");
  });
});

describe("markdown prose table cell wrapping", () => {
  it("restores normal wrapping and break-anywhere on cells", () => {
    const body = ruleBody(
      '.md-table-wrap th,\n[data-slot="markdown-prose"] .md-table-wrap td'
    );
    expect(body).toContain("white-space: normal");
    expect(body).toContain("overflow-wrap: anywhere");
  });

  it("does not reintroduce nowrap in the markdown table scope", () => {
    const tableBlock = css.slice(css.indexOf(".md-table-wrap"));
    expect(tableBlock).not.toMatch(/white-space:\s*nowrap/);
  });
});

describe("markdown prose table grid borders", () => {
  it("uses the separate border model with per-edge cell lines", () => {
    // collapse 模型的外框由表格绘制，滚动容器会裁掉左右边线；separate +
    // 逐边线（右/下每格、首行补上、首列补左）让所有线都留在单元格盒内。
    const tableBody = ruleBody(".md-table-wrap table");
    expect(tableBody).toContain("border-collapse: separate");
    expect(tableBody).toContain("border-spacing: 0");
    const cellBody = ruleBody(".md-table-wrap td");
    expect(cellBody).toContain("border-bottom: 1px solid var(--border)");
    expect(cellBody).toContain("border-right: 1px solid var(--border)");
    expect(ruleBody(".md-table-wrap thead th")).toContain(
      "border-top: 1px solid var(--border)"
    );
    expect(ruleBody(".md-table-wrap td:first-child")).toContain(
      "border-left: 1px solid var(--border)"
    );
  });

  it("rounds the four outer corners via corner cells and the wrap", () => {
    expect(ruleBody(".md-table-wrap")).toContain("border-radius: 0.375rem");
    expect(ruleBody(".md-table-wrap thead th:first-child")).toContain(
      "border-top-left-radius: 0.375rem"
    );
    expect(ruleBody(".md-table-wrap thead th:last-child")).toContain(
      "border-top-right-radius: 0.375rem"
    );
    expect(ruleBody(".md-table-wrap tr:last-child td:first-child")).toContain(
      "border-bottom-left-radius: 0.375rem"
    );
    expect(ruleBody(".md-table-wrap tr:last-child td:last-child")).toContain(
      "border-bottom-right-radius: 0.375rem"
    );
  });

  it("neutralizes shadcn row borders that would double cell lines", () => {
    expect(ruleBody(".md-table-wrap tr")).toContain("border-bottom: 0");
  });

  it("lights the th border itself on handle hover/focus (single line)", () => {
    expect(ruleBody(".md-col-resizer")).toContain("touch-action: none");
    expect(css).not.toMatch(/\.md-col-resizer::after/);
    // 拖拽期间（data-md-resizing）必须抑制高亮，只留全列指示线，避免双线。
    const highlight = css.slice(css.indexOf("th:has(> .md-col-resizer:hover)"));
    expect(highlight).toContain(".md-table-wrap:not([data-md-resizing])");
    expect(highlight).toContain("border-right-color");
  });
});

describe("markdown prose table reading proportions", () => {
  it("uses GitHub-grade padding and keeps header height padding-driven", () => {
    const cellBody = ruleBody(".md-table-wrap td");
    expect(cellBody).toContain("padding-block: 0.5em");
    expect(cellBody).toContain("padding-inline: 0.75em");
    expect(ruleBody(".md-table-wrap th {")).toContain("height: auto");
  });

  it("aligns numeric columns and stripes even body rows", () => {
    expect(ruleBody(".md-table-wrap table")).toContain(
      "font-variant: tabular-nums"
    );
    expect(ruleBody(".md-table-wrap tbody tr:nth-child(2n)")).toContain(
      "background-color: color-mix(in oklab, var(--muted) 40%, transparent)"
    );
  });

  it("positions the full-column drag line inside the scroll container", () => {
    expect(ruleBody(".md-table-wrap")).toContain("position: relative");
    const line = ruleBody(".md-col-resize-line");
    expect(line).toContain("width: 1px");
    expect(line).toContain("pointer-events: none");
  });
});
