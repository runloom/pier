import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-08-31-markdown-table-column-width-gold-standard.md";
const AGENTS = "AGENTS.md";
const RESIZE =
  "src/plugins/builtin/files/renderer/markdown/table/table-resize.tsx";
const PREFS =
  "src/plugins/builtin/files/renderer/markdown/table/table-width-preferences.ts";
const STRUCTURE =
  "src/plugins/builtin/files/renderer/markdown/table/structure-key.ts";
const PROSE = "src/plugins/builtin/files/renderer/markdown/prose.css";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("markdown table column width gold standard", () => {
  it("documents the contract in AGENTS.md and the 2026-08-31 spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(agents).toContain("### Markdown 预览表格列宽");
    expect(agents).toContain(
      "tests/unit/plugins/markdown/markdown-table-column-width-governance.test.ts"
    );
    expect(spec).toContain("width: max-content");
    expect(spec).toContain("结构键");
    expect(spec).toContain("磁吸否决");
    expect(spec).toContain("禁止复活此磁吸");
    expect(spec).toContain("display: block");
  });

  it("keeps wrap as the scroll owner and GitHub width language on the table", () => {
    const css = read(PROSE);
    expect(css).toContain("width: max-content");
    expect(css).toContain("max-width: 100%");
    expect(css).not.toMatch(
      /\[data-slot="markdown-prose"\] \.md-table-wrap table \{[^}]*display:\s*block/s
    );
    expect(css).toMatch(
      /\.md-table-wrap \[data-slot="table-container"\] \{[^}]*overflow-x:\s*visible/s
    );
  });

  it("keys widths by structure and commits on release, not per move", () => {
    expect(read(STRUCTURE)).toContain("tableWidthsKey");
    expect(read(STRUCTURE)).toContain("列数");
    const hook = read(RESIZE);
    expect(hook).toContain("widthsKey");
    expect(hook).not.toContain("contentHash");
    expect(hook).toContain('endDrag("commit")');
    expect(hook).toContain('endDrag("cancel")');
    expect(hook).toContain('endDrag("abort")');
    expect(hook).toContain("sessionRef.current");
    expect(read(PREFS)).toContain("TABLE_WIDTHS_STORAGE_PREFIX");
    expect(read(PREFS)).toContain("widthsKey");
  });

  it("does not reintroduce measure snapping", () => {
    const hook = read(RESIZE);
    expect(hook).not.toMatch(/SNAP/);
    expect(hook).not.toMatch(/clientWidth/);
    expect(read(PREFS)).not.toMatch(/SNAP/);
  });
});
