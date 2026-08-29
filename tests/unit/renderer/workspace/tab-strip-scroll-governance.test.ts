import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tab strip scroll ownership governance (P5 / G5).
 *
 * Spec: docs/superpowers/specs/2026-08-11-tab-strip-scroll-ownership-gold-standard.md
 */

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;

const WORKSPACE_ROOTS = [
  join(ROOT, "src", "renderer", "components", "workspace"),
  join(ROOT, "src", "renderer", "lib", "workspace"),
  join(ROOT, "src", "renderer", "stores"),
];

const TAB_STRIP_SCROLL_WRITE_ALLOWLIST = new Set([
  "src/renderer/lib/workspace/tab-strip-scroll.ts",
  "src/renderer/lib/workspace/tab-visibility.ts",
]);

const SCROLL_LEFT_ASSIGN_RE = /\.scrollLeft\s*=/;

function walkSourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split("\\").join("/");
}

describe("tab strip scroll ownership governance", () => {
  it("locks the gold-standard doc and owner modules", () => {
    const spec = readFileSync(
      join(
        ROOT,
        "docs/superpowers/specs/2026-08-11-tab-strip-scroll-ownership-gold-standard.md"
      ),
      "utf8"
    );
    expect(spec).toContain("Tab 条滚动所有权金标准");
    expect(spec).toContain("layout-restore");
    expect(spec).toContain("reveal-active");
    expect(spec).toContain("G5");

    const owner = readFileSync(
      join(ROOT, "src/renderer/lib/workspace/tab-strip-scroll.ts"),
      "utf8"
    );
    expect(owner).toContain("scheduleRestoreTabStripScrolls");
    expect(owner).toContain("ResizeObserver");
    expect(owner).toContain("RESTORE_HARD_TIMEOUT_MS");
    // Freeze-hold must not abort on non-programmatic scroll.
    expect(owner).toContain("frozen && !restoreInFlight");
    expect(owner).toContain("Maximize hold");
    expect(owner).not.toMatch(
      /requestAnimationFrame\(\(\)\s*=>\s*\{[\s\S]*?requestAnimationFrame\(/
    );

    const reveal = readFileSync(
      join(ROOT, "src/renderer/lib/workspace/tab-visibility.ts"),
      "utf8"
    );
    expect(reveal).toContain("withProgrammaticTabStripScroll");
    expect(reveal).toContain("ResizeObserver");
    expect(reveal).toContain("REVEAL_SETTLE_TIMEOUT_MS");
    expect(reveal).not.toMatch(
      /requestAnimationFrame\(\(\)\s*=>\s*\{[\s\S]*?requestAnimationFrame\(/
    );
  });

  it("keeps the dockview-core R2 patch (preserve Scrollbar offset)", () => {
    const patch = readFileSync(
      join(ROOT, "patches/dockview-core@7.0.2.patch"),
      "utf8"
    );
    expect(patch).toContain("Pier patch");
    expect(patch).toContain("preserve scroll offset");
    expect(patch).toContain("maximize");
    expect(patch).toContain("-            this._scrollOffset = 0;");
  });

  it("applies the R2 patch in the installed dockview-core tree", () => {
    // package dir includes patch hash — discover via readdir.
    const pnpmDir = join(ROOT, "node_modules/.pnpm");
    const entries = readdirSync(pnpmDir).filter((name) =>
      name.startsWith("dockview-core@7.0.2")
    );
    expect(entries.length).toBeGreaterThan(0);
    let foundPierComment = false;
    for (const entry of entries) {
      const scrollbar = join(
        pnpmDir,
        entry,
        "node_modules/dockview-core/dist/esm/scrollbar.js"
      );
      if (!statSync(scrollbar, { throwIfNoEntry: false })?.isFile()) {
        continue;
      }
      const source = readFileSync(scrollbar, "utf8");
      if (source.includes("Pier patch: preserve scroll offset")) {
        foundPierComment = true;
        break;
      }
    }
    expect(foundPierComment).toBe(true);
  });

  it("forbids workspace product code from assigning scrollLeft outside owner modules", () => {
    const violations: string[] = [];
    for (const root of WORKSPACE_ROOTS) {
      for (const file of walkSourceFiles(root)) {
        const rel = projectRelative(file);
        if (TAB_STRIP_SCROLL_WRITE_ALLOWLIST.has(rel)) {
          continue;
        }
        const source = readFileSync(file, "utf8");
        if (!SCROLL_LEFT_ASSIGN_RE.test(source)) {
          continue;
        }
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });

  it("documents terminal suppress + K2 restore gate wiring", () => {
    const focus = readFileSync(
      join(ROOT, "src/renderer/lib/workspace/terminal-focus-request.ts"),
      "utf8"
    );
    expect(focus).toContain("withSuppressedTabReveal");
    expect(focus).toContain('reveal: "never"');

    const behavior = readFileSync(
      join(ROOT, "src/renderer/components/workspace/tab-strip-behavior.ts"),
      "utf8"
    );
    expect(behavior).toContain("isLayoutRestoreInFlight");
    expect(behavior).toContain("scheduleRestoreAndUnfreeze");
  });

  it("wires maximize entry prepare and host attach", () => {
    const store = readFileSync(
      join(ROOT, "src/renderer/stores/workspace.store.ts"),
      "utf8"
    );
    expect(store).toContain("prepareTabStripScrollsForMaximizeLayoutMutation");
    expect(store).toContain("toggleActivePanelMaximized");

    const equalize = readFileSync(
      join(ROOT, "src/renderer/components/workspace/dockview-equalize.ts"),
      "utf8"
    );
    expect(equalize).toContain(
      "prepareTabStripScrollsForMaximizeLayoutMutation"
    );

    const host = readFileSync(
      join(ROOT, "src/renderer/components/workspace/host.tsx"),
      "utf8"
    );
    expect(host).toContain("attachWorkspaceTabStripBehavior");
    expect(host).toContain("installTabStripScrollFadeStyles");
  });
});
