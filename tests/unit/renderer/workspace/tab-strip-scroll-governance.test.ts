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
    // 到边不回弹：产品禁弹性格（用户决策 2026-11-12），overscroll-behavior
    // 必须是 none（覆盖 dockview 上游的 contain），规格要记录这个偏离。
    expect(spec).toContain("overscroll-behavior");
    expect(spec).toContain("不回弹");

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

  it("disables rubber-band bounce on the tab strip", () => {
    // .dv-tabs-container 由 dockview 拥有（overflow:auto + 上游 contain 保
    // 留了 macOS 弹性）。产品决策：到边不回弹——工作台 chrome 不是内容
    // 滚动面，回弹的「还有更多」信号已由 scroll-fade 和 ▾ 溢出菜单承担。
    // 覆盖必须挂在 dockview-theme-pier 选择器下（单一主题命名空间），
    // 只关 x 轴弹性；y 轴是纵向 tab 条（touch-action: pan-y）不在本决策内。
    const css = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const override = css.match(
      /\.dockview-theme-pier \.dv-tabs-container\s*\{[^}]*\}/
    );
    expect(override).not.toBeNull();
    expect(override?.[0]).toContain("overscroll-behavior-x: none");
    // 不能顺手把上游的 contain 全量放开或改成 none 之外的手段。
    expect(override?.[0]).not.toContain("overscroll-behavior:");
  });

  it("renders the overflow count with tabular numerals", () => {
    // 溢出计数（▾ 12）由 dockview 动态创建、无 class，宽度随位数变化会跳。
    // 数字型 chrome 一律 tabular-nums（同 tab 尾部 git ±N / git 状态条）；
    // 不整段换 mono：JetBrains 字形和 tab 标题的 system-ui 混排不协调。
    const css = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    expect(css).toContain(
      ".dockview-theme-pier .dv-tabs-overflow-dropdown-default > span"
    );
    expect(css).toMatch(
      /\.dockview-theme-pier \.dv-tabs-overflow-dropdown-default > span\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/
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

  it("clears the absolute drop overlay when HTML5 drag leaves the document", () => {
    const patch = readFileSync(
      join(ROOT, "patches/dockview-core@7.0.2.patch"),
      "utf8"
    );
    expect(patch).toContain("dndOverlayMounting: absolute");
    expect(patch).toContain("onDocumentDragLeave");
    expect(patch).toContain("document.addEventListener('dragleave'");
    expect(patch).toContain("document.documentElement.contains(related)");
    expect(patch).toContain(
      "this.model) === null || _a === void 0 ? void 0 : _a.clear()"
    );
  });

  it("clears the absolute drop overlay when HTML5 drag ends in-window", () => {
    const patch = readFileSync(
      join(ROOT, "patches/dockview-core@7.0.2.patch"),
      "utf8"
    );
    expect(patch).toContain("onDocumentDragEnd");
    expect(patch).toContain("document.addEventListener('dragend'");
    expect(patch).toContain("document.removeEventListener('dragend'");
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

  it("applies the document-dragend overlay clear in installed dockview-core", () => {
    const pnpmDir = join(ROOT, "node_modules/.pnpm");
    const entries = readdirSync(pnpmDir).filter((name) =>
      name.startsWith("dockview-core@7.0.2")
    );
    expect(entries.length).toBeGreaterThan(0);
    let foundEndClear = false;
    for (const entry of entries) {
      const bundled = join(
        pnpmDir,
        entry,
        "node_modules/dockview-core/dist/package/main.esm.mjs"
      );
      if (!statSync(bundled, { throwIfNoEntry: false })?.isFile()) {
        continue;
      }
      const source = readFileSync(bundled, "utf8");
      if (
        source.includes("onDocumentDragEnd") &&
        source.includes("document.addEventListener('dragend'")
      ) {
        foundEndClear = true;
        break;
      }
    }
    expect(foundEndClear).toBe(true);
  });

  it("applies the document-dragleave overlay clear in installed dockview-core", () => {
    const pnpmDir = join(ROOT, "node_modules/.pnpm");
    const entries = readdirSync(pnpmDir).filter((name) =>
      name.startsWith("dockview-core@7.0.2")
    );
    expect(entries.length).toBeGreaterThan(0);
    let foundLeaveClear = false;
    for (const entry of entries) {
      const bundled = join(
        pnpmDir,
        entry,
        "node_modules/dockview-core/dist/package/main.esm.mjs"
      );
      if (!statSync(bundled, { throwIfNoEntry: false })?.isFile()) {
        continue;
      }
      const source = readFileSync(bundled, "utf8");
      if (
        source.includes("onDocumentDragLeave") &&
        source.includes("document.addEventListener('dragleave'")
      ) {
        foundLeaveClear = true;
        break;
      }
    }
    expect(foundLeaveClear).toBe(true);
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
