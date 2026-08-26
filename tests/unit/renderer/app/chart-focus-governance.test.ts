import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" ||
      name === "dist" ||
      name === "dist-builder" ||
      name === ".git" ||
      name === "coverage"
    ) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (/\.(tsx|ts|css)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Focus 纪律（与 AGENTS.md「焦点与 Tab 序规范」绑定）：
 * - 鼠标点中不画 UA outline（globals :focus:not(:focus-visible)）
 * - 真正可操作控件用 focus-visible ring（ring-ring/30~50）
 * - 展示型图 / 状态徽标 / 节点图不进 Tab 序
 * - 业务高亮 ≠ focus（ring-ring，不用 ring-primary）
 */
describe("focus governance", () => {
  it("documents focus and tab-order rules in AGENTS.md", () => {
    const agents = source("AGENTS.md");
    expect(agents).toContain("### 焦点与 Tab 序规范");
    expect(agents).toContain(":focus:not(:focus-visible)");
    expect(agents).toContain("accessibilityLayer={false}");
    expect(agents).toContain("tabIndex={0}");
    expect(agents).toContain("chart-focus-governance.test.ts");
    expect(agents).toContain("ring-primary");
  });

  it("suppresses mouse-only UA outlines at the base layer", () => {
    const css = source("src/renderer/app/globals.css");
    expect(css).toContain(":focus:not(:focus-visible)");
    expect(css).toMatch(/:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none;/);
  });

  it("defaults ChartContainer children to non-tabbable display charts", () => {
    const chart = source("packages/ui/src/chart.tsx");
    expect(chart).toContain("withDisplayChartDefaults");
    expect(chart).toContain("React.Children.map");
    expect(chart).toContain("accessibilityLayer: false");
    expect(chart).toContain("[&_.recharts-surface]:outline-none");
    expect(chart).toContain("[&_.recharts-surface]:focus-visible:outline-none");
    expect(chart).toContain("[&_.recharts-wrapper]:outline-none");
  });

  it("keeps DataChart off the accessibility tab layer", () => {
    const dataChart = source("packages/ui/src/data-chart.tsx");
    expect(dataChart).toContain("accessibilityLayer: false");
    expect(dataChart).toContain("accessibilityLayer={false}");
    expect(dataChart).not.toMatch(/accessibilityLayer:\s*true/);
    expect(dataChart).not.toMatch(/accessibilityLayer=\{true\}/);
  });

  it("does not put language-service status badges in the tab order", () => {
    const status = source(
      "src/plugins/builtin/files/renderer/panel/status.tsx"
    );
    expect(status).not.toMatch(/tabIndex=\{0\}/);
    expect(status).toContain("aria-label=");
  });

  it("gates Mermaid keyboard focus on interactive contracts only", () => {
    const graph = source("packages/ui/src/mermaid/scene.tsx");
    const shell = source("packages/ui/src/mermaid/shell.tsx");
    const mark = source("packages/ui/src/mermaid/mark.tsx");
    // 纯展示不进 Tab；onSelectNode 时节点才可键盘激活
    expect(graph).toContain(
      "const keyboardSelectable = onSelectNode !== undefined"
    );
    expect(mark).toContain('type="button"');
    expect(mark).toContain('role="img"');
    expect(graph).not.toContain("nodesFocusable");
    expect(graph).not.toContain("@xyflow/react");
    // Expanded chrome splits roots: application when selectable, img otherwise.
    expect(shell).toContain('role="application"');
    expect(shell).toContain('role="img"');
    expect(graph).not.toContain('colorMode="system"');
  });

  it("allows only intentional product tabIndex={0} stops", () => {
    const allow = new Set([
      // 键盘合约：缩放/平移、图片 diff 滑动条、表格列宽分隔条、右键菜单、tab 激活、列表项
      "packages/ui/src/image-preview/canvas.tsx",
      "packages/ui/src/image-preview/world-canvas.tsx",
      "packages/ui/src/diff-view/image-diff/compare.tsx",
      "src/plugins/builtin/files/renderer/markdown/table/table-resize.tsx", // table column resize separator (arrow-key adjustable, mirrors image diff slider)
      "src/plugins/builtin/files/renderer/preview/image.tsx",
      "src/renderer/components/workspace/panel-tab-header.tsx",
      "src/renderer/pages/settings/components/project/section-list.tsx",
    ]);

    // 只扫产品源码；测试夹具可自由 tabIndex。
    const roots = ["packages", "src"].map((d) => join(ROOT, d));
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walkFiles(root)) {
        const rel = relative(ROOT, file).replaceAll("\\", "/");
        if (rel.includes("node_modules")) continue;
        const text = readFileSync(file, "utf8");
        if (!(text.includes("tabIndex={0}") || text.includes("tabIndex: 0"))) {
          continue;
        }
        if (allow.has(rel)) continue;
        hits.push(rel);
      }
    }
    expect(hits).toEqual([]);
  });

  it("avoids ring-primary as focus chrome in product UI sources", () => {
    // 与 AGENTS「禁止用 ring-primary 当 focus 铬」对齐：任意 ring-primary(/N) 命中
    const ringPrimary = /\bring-primary(?:\/\d+)?\b/;
    const roots = [
      join(ROOT, "packages/ui/src"),
      join(ROOT, "src/renderer"),
      join(ROOT, "src/plugins"),
    ];
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walkFiles(root)) {
        const rel = relative(ROOT, file).replaceAll("\\", "/");
        const text = readFileSync(file, "utf8");
        if (ringPrimary.test(text)) {
          hits.push(rel);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("styles dockview outer tab focus-visible ring in globals", () => {
    const css = source("src/renderer/app/globals.css");
    expect(css).toContain(".dockview-theme-pier .dv-tab:focus-visible");
    expect(css).toContain("var(--ring)");
  });
});
