import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_ROOTS = [
  join(ROOT, "packages/ui/src"),
  join(ROOT, "src/plugins/builtin"),
  join(ROOT, "src/renderer"),
] as const;
const SOURCE_FILE_EXTENSION = /\.(css|tsx?|jsx?)$/;
const SPEC =
  "docs/superpowers/specs/2026-09-04-transparent-web-over-ghostty-compositing-gold-standard.md";
const FORCED_COMPOSITING_MARKERS = [
  ["backface-visibility", /\bbackface-visibility\s*:/],
  ["perspective", /\bperspective\s*\(/],
  ["transform-gpu", /\btransform-gpu\b/],
  ["translate-z", /\btranslate-z-/],
  ["translate3d", /\btranslate3d\s*\(/],
  ["translateZ", /\btranslateZ\s*\(/],
  [
    "will-change-transform",
    /\bwill-change\s*:\s*transform\b|\bwill-change-\[?transform\]?\b/,
  ],
] as const;
const BACKDROP_FILTER_MARKERS = [
  ["backdrop-blur", /\bbackdrop-blur(?:-|\b)/],
  ["backdrop-filter", /\bbackdrop-filter\s*:/],
  ["filter-blur", /\bfilter\s*:\s*blur\s*\(/],
] as const;

/**
 * Product files that may keep a marker. Each entry must name the marker and
 * why it cannot use an opaque fill / 2D position instead. Empty is the goal.
 */
const COMPOSITING_ALLOWLIST: readonly {
  file: string;
  marker: string;
  reason: string;
}[] = [];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (SOURCE_FILE_EXTENSION.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function allProductSourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => sourceFiles(root));
}

function matchesFor(
  markers: readonly (readonly [string, RegExp])[]
): { file: string; marker: string }[] {
  return allProductSourceFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    return markers.flatMap(([marker, pattern]) =>
      pattern.test(source) ? [{ file: rel, marker }] : []
    );
  });
}

function allowed(entry: { file: string; marker: string }): boolean {
  return COMPOSITING_ALLOWLIST.some(
    (item) => item.file === entry.file && item.marker === entry.marker
  );
}

describe("renderer GPU 合成层治理", () => {
  it("documents the Ghostty compositing contract in AGENTS.md and the spec", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    const spec = readFileSync(join(ROOT, SPEC), "utf8");
    expect(agents).toContain("### 透明 web 叠 Ghostty 合成");
    expect(agents).toContain("gpu-compositing-governance.test.ts");
    expect(agents).toContain("backdrop-filter");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("backdrop-filter");
    expect(spec).toContain("packages/ui");
    expect(spec).toContain("分栏不准藏 native");
  });

  it("禁止产品表面为合成层强制三维位移", () => {
    const matches = matchesFor(FORCED_COMPOSITING_MARKERS).filter(
      (entry) => !allowed(entry)
    );
    expect(matches).toEqual([]);
  });

  it("禁止产品表面用 backdrop-filter / blur 采样透明洞后的 Ghostty", () => {
    const matches = matchesFor(BACKDROP_FILTER_MARKERS).filter(
      (entry) => !allowed(entry)
    );
    expect(matches).toEqual([]);
  });

  it("allowlist entries still exist and name a reason", () => {
    for (const item of COMPOSITING_ALLOWLIST) {
      expect(item.reason.trim().length).toBeGreaterThan(8);
      expect(existsSync(join(ROOT, item.file))).toBe(true);
    }
  });
});
