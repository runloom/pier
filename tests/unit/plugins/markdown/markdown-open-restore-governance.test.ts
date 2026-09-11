import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-06-files-markdown-open-restore-gold-standard.md";
const AGENTS = "AGENTS.md";
const MEMORY = "src/plugins/builtin/files/renderer/markdown/scroll-memory.ts";
const PREVIEW = "src/plugins/builtin/files/renderer/markdown/preview.tsx";
const ACTIONS = "src/plugins/builtin/files/renderer/panel/actions.tsx";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("markdown open restore gold standard", () => {
  it("documents the contract in AGENTS.md and the 2026-09-06 spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(agents).toContain("### Markdown 打开姿态（阅读位置与变更计数）");
    expect(agents).toContain(
      "tests/unit/plugins/markdown/markdown-open-restore-governance.test.ts"
    );
    expect(agents).toContain("顶栏禁止 FileDiff");
    expect(agents).toContain("不进 userData");
    expect(agents).toContain("sourceValue === value");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("{ v: 2, offset, blockProgress? }");
    expect(spec).toContain("禁止复活这些路径");
    expect(spec).toContain("禁止复活顶栏芯片");
    expect(spec).toContain("markdownPagesToForceForOffset");
    expect(spec).toContain("sourceValue === value");
  });

  it("persists source offset, not pixel scrollTop, and ignores v1 pixels", () => {
    const memory = read(MEMORY);
    const preview = read(PREVIEW);
    expect(memory).toContain("v: 2");
    expect(memory).toContain("MARKDOWN_SCROLL_MEMORY_VERSION");
    expect(memory).toContain("captureMarkdownPreviewAnchor");
    expect(memory).toContain("shouldCaptureMarkdownPreviewScroll");
    expect(memory).toContain("IntersectionObserver");
    expect(memory).toContain("flushPendingNowRef");
    expect(memory).not.toContain("djb2");
    expect(memory).not.toMatch(/scrollRoot\.scrollTop\s*=/);
    expect(memory).not.toMatch(/top:\s*Math\.round/);
    expect(preview).toContain("memoryAnchor");
    expect(preview).toContain("contentAnchor ?? memoryAnchor");
    expect(preview).toContain("state.sourceValue === value");
    expect(preview).not.toMatch(/scrollRoot\.scrollTop\s*=/);
  });

  it("does not mount a file-changes chip in the files toolbar", () => {
    const actions = read(ACTIONS);
    expect(actions).not.toContain("FileChangesToolbarButton");
    expect(actions).not.toContain("file-changes-trigger");
    expect(actions).not.toContain("git-changes/toolbar-button");
  });
});
