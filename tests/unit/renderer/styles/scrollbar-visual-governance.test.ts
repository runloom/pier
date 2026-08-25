import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const SKIP_DIR_RE = /(?:^|\/)(?:node_modules|dist|coverage|\.git)(?:\/|$)/;

const HOVER_TYPE_ALLOWLIST = new Set([
  "packages/ui/src/scroll-area.tsx",
  "src/plugins/builtin/files/renderer/markdown/preview-toc.tsx",
]);

const NONE_ALLOWLIST = new Set([
  "packages/ui/src/auto-hide-scrollbar.ts",
  "packages/ui/src/command.tsx",
  "packages/ui/src/file/panel-breadcrumb.tsx",
  "packages/ui/src/image-preview/canvas.tsx",
  "packages/ui/src/image-preview/world-canvas.tsx",
  "packages/ui/src/scroll-area.tsx",
  "src/plugins/builtin/files/renderer/markdown/preview-toc.tsx",
  "src/renderer/components/common/notifications/center-control.tsx",
  "src/renderer/components/primitives/sidebar.tsx",
  "src/renderer/panel-kits/terminal/composer-attachment/rail.tsx",
  "src/renderer/panel-kits/terminal/structured-composer/composer-suggest-list.tsx",
]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (SKIP_DIR_RE.test(filePath)) {
      continue;
    }
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...walk(filePath));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function rel(filePath: string): string {
  return relative(ROOT, filePath);
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function hidesProductScrollbar(source: string): boolean {
  if (
    source.includes('data-scrollbar="none"') ||
    source.includes("data-scrollbar='none'") ||
    /data-scrollbar=\{['"]none['"]\}/.test(source)
  ) {
    return true;
  }
  return (
    /data-scrollbar=\{scrollbar\}/.test(source) &&
    /scrollbar\s*=\s*["']none["']/.test(source)
  );
}

describe("scrollbar visual gold standard", () => {
  it("documents the appearance contract in AGENTS.md and the 2026-08-19 spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(
      "docs/superpowers/specs/2026-08-19-scrollbar-visual-gold-standard.md"
    );
    const prior = read(
      "docs/superpowers/specs/2026-07-29-workbench-scroll-viewport-design.md"
    );

    expect(agents).toContain("### 滚动条外观");
    expect(agents).toContain("scrollbar-visual-governance.test.ts");
    expect(spec).toContain("不透明");
    expect(spec).toContain("spareNativeScrollbar");
    expect(spec).toContain("4px");
    expect(prior).toContain("2026-08-19-scrollbar-visual-gold-standard.md");
  });

  it("keeps the product thumb opaque against --background", () => {
    const globals = read("src/renderer/app/globals.css");
    expect(globals).toMatch(
      /--shell-scrollbar-thumb:\s*color-mix\(\s*in oklab,\s*var\(--foreground\) 22%,\s*var\(--background\)/
    );
    expect(globals).toMatch(
      /--shell-scrollbar-thumb-active:\s*color-mix\(\s*in oklab,\s*var\(--foreground\) 38%,\s*var\(--background\)/
    );
    expect(globals).toContain("--shell-scrollbar-width-legacy: 11px");
    expect(globals).not.toMatch(
      /--shell-scrollbar-thumb:\s*color-mix\([^)]*transparent/
    );
  });

  it("spares native gutters when fade and a visible bar share a node", () => {
    const globals = read("src/renderer/app/globals.css");
    const tree = read("packages/ui/src/file/tree-style.ts");
    const fade = read("packages/ui/src/scroll-area.tsx");

    expect(globals).toContain('data-scrollbar="stable"');
    expect(globals).toContain('data-scrollbar="overlay"');
    expect(globals).toContain("--shell-scrollbar-gutter-mask:");
    expect(globals).toContain("mask-composite: add");
    expect(globals).not.toContain("mask-clip: content-box");
    expect(tree).toContain('spareNativeScrollbar: "inline-end"');
    expect(fade).toContain('spareNativeScrollbar?: "inline-end"');
    expect(fade).toContain("var(--shell-scrollbar-gutter-mask)");
    expect(fade).toContain("mask-composite: add");
  });

  it("pins trees hover thumbs transparent unless Pier activity bits are set", () => {
    const system = read("packages/ui/src/scrollbar-system.ts");
    expect(system).toContain("--trees-scrollbar-thumb-current: transparent");
    expect(system).toContain(
      '[data-file-tree-virtualized-scroll="true"]:hover'
    );
    expect(system).toContain(
      '[data-file-tree-virtualized-scroll="true"][data-scrollbar-scrolling="true"]'
    );
  });

  it("aligns dockview tab overflow bars to the product thumb token", () => {
    const globals = read("src/renderer/app/globals.css");
    expect(globals).toContain(
      "--dv-scrollbar-background-color: var(--shell-scrollbar-thumb)"
    );
    expect(globals).toContain("border-radius: var(--shell-scrollbar-radius)");
    expect(globals).not.toContain(".dv-scrollable:hover");
    expect(globals).not.toMatch(
      /--dv-scrollbar-background-color:\s*color-mix\(/
    );
    expect(read("packages/ui/src/scrollbar-system.ts")).not.toMatch(/#000\b/);
  });

  it("allowlists type=hover and data-scrollbar=none call sites", () => {
    const roots = [
      join(ROOT, "src"),
      join(ROOT, "packages", "ui", "src"),
      join(ROOT, "packages", "plugin-api", "src"),
    ];
    const hoverHits: string[] = [];
    const noneHits: string[] = [];

    for (const root of roots) {
      for (const filePath of walk(root)) {
        const source = readFileSync(filePath, "utf8");
        const path = rel(filePath);
        if (/type\s*=\s*["']hover["']/.test(source)) {
          hoverHits.push(path);
        }
        if (hidesProductScrollbar(source)) {
          noneHits.push(path);
        }
      }
    }

    expect(hoverHits.sort()).toEqual([...HOVER_TYPE_ALLOWLIST].sort());
    expect(noneHits.sort()).toEqual([...NONE_ALLOWLIST].sort());
  });
});
