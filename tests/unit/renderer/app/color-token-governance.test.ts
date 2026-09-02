import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(css|html|js|jsx|mjs|scss|svg|ts|tsx)$/;
const RAW_COLOR_RE =
  /(?<![\w])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\da-f\w])|\b(?:hsl|hsla|oklab|oklch|rgb|rgba)\s*\(/i;
const FIXED_TAILWIND_COLOR_RE =
  /\b(?:accent|bg|border|caret|decoration|divide|fill|from|outline|placeholder|ring|shadow|stroke|text|to|via)-(?:black|white|(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3})\b/;
const FIXED_TAILWIND_COLOR_VAR_RE =
  /--color-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3}\b/;
const SKIPPED_DIRECTORIES = new Set(["build", "dist", "node_modules", "out"]);
const RAW_COLOR_WHOLE_FILE_OWNERS = new Set([
  // Native data-URL fallback loads when the renderer/theme pipeline is unavailable.
  "src/main/windows/renderer-recovery-page.ts",
  "src/renderer/app/globals.css",
  "src/plugins/api/components/agent-icons/glyphs.tsx",
  "src/renderer/lib/theme/derive-editor-decoration-tokens.ts",
  "src/renderer/lib/theme/derive-terminal-colors.ts",
  "src/renderer/lib/theme/derive-tokens.ts",
  "src/renderer/lib/theme/oklch.ts",
  // Single owner for Pierre's brand palette and derived editor/theme overlay.
  "src/renderer/lib/theme/pierre-brand-overlay.ts",
  "src/shared/theme-colors.ts",
]);
const RAW_COLOR_LITERAL_ALLOWANCES = new Map<string, RegExp>([
  ["packages/ui/src/chart.tsx", /#(?:ccc|fff)\b/gi],
  // Scroll fade masks use opaque black stops; alpha is via transparent end, not product chrome.
  ["packages/ui/src/scroll-area.tsx", /#000\b/gi],
  ["src/renderer/index.html", /#1e1e1e\b/gi],
]);
const COLOR_MIX_OWNERS = new Set([
  "packages/ui/src/diff-view/appearance.ts",
  // Diff/review estimate skeleton: shadow DOM bars use Canvas/CanvasText mixes
  // (no access to product CSS variables inside Pierre's shadow root).
  "packages/ui/src/diff-view/estimate-skeleton.ts",
  // Native data-URL fallback cannot consume renderer theme tokens.
  "src/main/windows/renderer-recovery-page.ts",
  "src/plugins/builtin/files/renderer/editor/cm-theme.ts",
  // Shared source-editor chrome (files + settings Rules/Skills); semantic token mixes only.
  "src/shared/source-editor/theme.ts",
  // Standalone SVG previews bake fg/bg mixes so data-URL lightbox is not black.
  "packages/ui/src/image-preview/bake-svg-for-standalone-preview.ts",
  // Table thead chrome mirrors code-block `bg-muted/40` (Tailwind class unavailable
  // in this CSS entry without @reference).
  "src/plugins/builtin/files/renderer/markdown/prose.css",
  // Pierre Diff header hover mixes muted into background inside unsafeCSS
  // (shadow DOM cannot consume Tailwind opacity utilities).
  "src/renderer/app/globals.css",
  "src/renderer/lib/plugins/mermaid/render.worker.ts",
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        files.push(...sourceFiles(filePath));
      }
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split(sep).join("/");
}

function containsUnauthorizedRawColor(filePath: string): boolean {
  const relativePath = projectRelative(filePath);
  if (RAW_COLOR_WHOLE_FILE_OWNERS.has(relativePath)) {
    return false;
  }
  const allowance = RAW_COLOR_LITERAL_ALLOWANCES.get(relativePath);
  const source = readFileSync(filePath, "utf8");
  return RAW_COLOR_RE.test(allowance ? source.replace(allowance, "") : source);
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`${escaped}\\s*\\{`).exec(source);
  if (!header) {
    throw new Error(`missing CSS block: ${selector}`);
  }
  const start = header.index + header[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index);
      }
    }
  }
  throw new Error(`unclosed CSS block: ${selector}`);
}

function hasCssVariable(block: string, name: string): boolean {
  return new RegExp(`--${name}:\\s*[^;]+;`).test(block);
}

function cssVariable(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match?.[1]) throw new Error(`missing CSS variable: --${name}`);
  return match[1].trim();
}

function neutralOklchLightness(value: string): number {
  const match = /^oklch\(([\d.]+)\s+0\s+0\)$/.exec(value);
  if (!match?.[1]) throw new Error(`expected neutral OKLCH value: ${value}`);
  return Number.parseFloat(match[1]);
}

describe("color token governance", () => {
  const files = [join(ROOT, "src"), join(ROOT, "packages")].flatMap(
    sourceFiles
  );

  it("documents one-way color ownership in the project context", () => {
    const context = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

    expect(context).toContain("### 颜色使用规范");
    expect(context).toContain("主题原色 → 语义令牌 → 组件变体 → 业务映射");
  });

  it("keeps raw colors inside explicit palette, theme, native, or brand owners", () => {
    const offenders = files
      .filter(containsUnauthorizedRawColor)
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("keeps color derivation inside the palette or an explicit editor engine", () => {
    const offenders = files
      .filter((filePath) => !COLOR_MIX_OWNERS.has(projectRelative(filePath)))
      .filter((filePath) =>
        /\bcolor-mix\s*\(/i.test(readFileSync(filePath, "utf8"))
      )
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("forbids fixed Tailwind palette classes and variables in production source", () => {
    const offenders = files
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return (
          FIXED_TAILWIND_COLOR_RE.test(source) ||
          FIXED_TAILWIND_COLOR_VAR_RE.test(source)
        );
      })
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("mirrors theme status tokens inside markdown paper scopes", () => {
    // 纸面（data-reading-appearance）换基础 token；状态色若不镜像对应主题
    // 的调校值，callout / 搜索高亮 / Mermaid tone 会拿到另一主题的色调
    // （暗色主题浅黄 warning 落在白纸上）。复合公式（neutral/done/滚动条/
    // interactive hover / action-secondary-hover）引用基础 token，必须在
    // 纸面作用域按同一公式重算。toast 在 portal 外，禁止镜像。
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const normalize = (value: string) => value.replace(/\s+/g, " ");
    const themeBlocks = {
      dark: cssBlock(globals, ":root"),
      light: cssBlock(globals, ":root.light"),
    } as const;
    const LITERAL_TOKENS = [
      "destructive",
      "destructive-foreground",
      "warning",
      "warning-foreground",
      "success",
      "info",
      "done",
      "status-solid-foreground",
      "status-info-bg",
      "status-info-fg",
      "status-info-border",
      "status-success-bg",
      "status-success-fg",
      "status-success-border",
      "status-warning-bg",
      "status-warning-fg",
      "status-warning-border",
      "status-danger-bg",
      "status-danger-fg",
      "status-danger-border",
    ] as const;
    const FORMULA_TOKENS = [
      "status-neutral-bg",
      "status-neutral-fg",
      "status-neutral-border",
      "status-done-bg",
      "status-done-fg",
      "status-done-border",
      "shell-scrollbar-thumb",
      "shell-scrollbar-thumb-active",
      "interactive-hover",
      "interactive-active",
      "action-secondary-hover",
      "action-accent",
      "action-accent-foreground",
      "action-muted",
      "action-danger",
    ] as const;
    for (const appearance of ["light", "dark"] as const) {
      const paper = cssBlock(
        globals,
        `[data-slot="markdown-preview-root"][data-reading-appearance="${appearance}"]`
      );
      expect(paper, `${appearance} paper must not mirror toast`).not.toContain(
        "--toast-surface"
      );
      expect(paper).not.toContain("--toast-foreground");
      for (const token of LITERAL_TOKENS) {
        expect(
          normalize(cssVariable(paper, token)),
          `${appearance} paper --${token}`
        ).toBe(normalize(cssVariable(themeBlocks[appearance], token)));
      }
      for (const token of FORMULA_TOKENS) {
        const themeSource =
          appearance === "light" && hasCssVariable(themeBlocks.light, token)
            ? themeBlocks.light
            : themeBlocks.dark;
        expect(
          normalize(cssVariable(paper, token)),
          `${appearance} paper --${token} formula`
        ).toBe(normalize(cssVariable(themeSource, token)));
      }
    }
  });

  it("keeps content-preview color-mode selectors paired with the paper blocks", () => {
    // The fullscreen preview overlay reuses the paper token blocks via a
    // selector list. The block-level locks anchor on the markdown selector
    // (kept LAST), so deleting the content-preview line would fail nothing
    // else — assert the pairing explicitly for both modes.
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    for (const mode of ["light", "dark"] as const) {
      expect(globals).toContain(
        `[data-slot="content-preview"][data-color-mode="${mode}"],\n[data-slot="markdown-preview-root"][data-reading-appearance="${mode}"] {`
      );
    }
  });

  it("keeps neutral actions independent from semantic state colors", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const button = readFileSync(
      join(ROOT, "packages/ui/src/button.tsx"),
      "utf8"
    );

    expect(globals).toContain("--action-accent: var(--primary)");
    expect(globals).toContain("--action-danger: var(--destructive)");
    expect(globals).toContain("--action-muted: var(--muted-foreground)");
    expect(button).toContain("bg-action-accent");
    expect(button).toContain("text-action-danger");
    expect(button).not.toContain("text-status-info-fg");
  });

  it("keeps sidebar list wash tokens neutral, calibrated, and product-ring focused", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const themeTokens = readFileSync(
      join(ROOT, "packages/ui/src/tailwind-theme.css"),
      "utf8"
    );
    const treeStyle = readFileSync(
      join(ROOT, "packages/ui/src/file/tree-style.ts"),
      "utf8"
    );
    const dark = cssBlock(globals, ":root");
    const light = cssBlock(globals, ":root.light");

    // Dark defaults (muted sidebar needs slightly higher lift than light).
    expect(cssVariable(dark, "list-hover-bg")).toBe(
      "color-mix(in oklab, var(--foreground) 8%, var(--sidebar))"
    );
    expect(cssVariable(dark, "list-active-bg")).toBe(
      "color-mix(in oklab, var(--foreground) 14%, var(--sidebar))"
    );
    // Soft --ring (dockview-aligned); never CTA --primary as focus chrome.
    expect(cssVariable(dark, "list-focus-ring")).toBe(
      "color-mix(in oklab, var(--ring) 40%, transparent)"
    );
    // Light retunes washes only; focus ring is single :root definition.
    expect(cssVariable(light, "list-hover-bg")).toBe(
      "color-mix(in oklab, var(--foreground) 5%, var(--sidebar))"
    );
    expect(cssVariable(light, "list-active-bg")).toBe(
      "color-mix(in oklab, var(--foreground) 9%, var(--sidebar))"
    );
    expect(light).not.toMatch(/--list-focus-ring\s*:/);

    // No planned-but-unused inactive selection token.
    expect(globals).not.toContain("--list-inactive-bg");
    expect(themeTokens).not.toContain("--color-list-inactive-bg");
    // Consumed list tokens are exposed to Tailwind.
    expect(themeTokens).toContain(
      "--color-list-hover-bg: var(--list-hover-bg)"
    );
    expect(themeTokens).toContain(
      "--color-list-active-bg: var(--list-active-bg)"
    );
    expect(themeTokens).toContain(
      "--color-list-focus-ring: var(--list-focus-ring)"
    );

    // Fills stay neutral (fg@sidebar); focus ring shared across tree slots.
    expect(dark).not.toMatch(
      /--list-(?:hover|active)-bg:[^;]*var\(--primary\)/
    );
    expect(light).not.toMatch(
      /--list-(?:hover|active)-bg:[^;]*var\(--primary\)/
    );
    expect(treeStyle).toContain(
      '"--trees-bg-muted-override": "var(--list-hover-bg)"'
    );
    expect(treeStyle).toContain(
      '"--trees-selected-bg-override": "var(--list-active-bg)"'
    );
    expect(treeStyle).toContain(
      '"--trees-focus-ring-color-override": "var(--list-focus-ring)"'
    );
    expect(treeStyle).toContain(
      '"--trees-selected-focused-border-color-override": "var(--list-focus-ring)"'
    );
    expect(treeStyle).not.toMatch(
      /--trees-(?:bg-muted|selected-bg)-override":\s*"[^"]*primary/
    );
  });

  it("maps quota health and cost charts to existing semantic colors", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const themeTokens = readFileSync(
      join(ROOT, "packages/ui/src/tailwind-theme.css"),
      "utf8"
    );
    const progress = readFileSync(
      join(ROOT, "packages/ui/src/progress.tsx"),
      "utf8"
    );

    expect(globals).not.toContain("--data-primary:");
    expect(globals).not.toContain("--data-cost:");
    expect(themeTokens).not.toContain("--color-data-primary:");
    expect(themeTokens).not.toContain("--color-data-cost:");
    expect(progress).toContain('success: "bg-success"');
    expect(progress).toContain('warning: "bg-warning"');
    expect(progress).toContain('destructive: "bg-destructive"');
    expect(progress).not.toContain('data: "bg-data-primary"');
  });

  // ── Soft status surfaces (Ant Design Alert map tokens) ─────────────
  // Soft alerts/badges use colorXxxBg + colorXxxBorder for surfaces; bg and
  // border stay on Ant's default-algorithm seeds. Light-theme fg deliberately
  // deviates to the SAME Ant family's 7/8 steps (#0958d9 / #237804 / #874d00 /
  // #cf1322): badge text at 11–12px on the tinted bg must clear Tier-1 4.5:1,
  // and Ant's 6-step seeds (#faad14 on #fffbe6 ≈ 1.5:1) cannot. Dark fg keeps
  // the Ant dark-algorithm seeds (Tier-3 design decision below).

  it("keeps Ant Design soft status map tokens for both themes", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const light = cssBlock(globals, ":root.light");
    const dark = cssBlock(globals, ":root");

    expect(cssVariable(light, "status-warning-bg")).toBe("#fffbe6");
    expect(cssVariable(light, "status-warning-border")).toBe("#ffe58f");
    expect(cssVariable(light, "status-warning-fg")).toBe("#874d00");
    expect(cssVariable(light, "warning")).toBe("#faad14");

    expect(cssVariable(dark, "status-warning-bg")).toBe("#2b2111");
    expect(cssVariable(dark, "status-warning-border")).toBe("#594214");
    expect(cssVariable(dark, "status-warning-fg")).toBe("#d89614");
    expect(cssVariable(dark, "warning")).toBe("#d89614");

    expect(cssVariable(light, "status-info-bg")).toBe("#e6f4ff");
    expect(cssVariable(light, "status-success-bg")).toBe("#f6ffed");
    expect(cssVariable(light, "status-danger-bg")).toBe("#fff2f0");
    expect(cssVariable(light, "status-info-fg")).toBe("#0958d9");
    expect(cssVariable(light, "status-success-fg")).toBe("#237804");
    expect(cssVariable(light, "status-danger-fg")).toBe("#cf1322");
    expect(cssVariable(dark, "status-info-bg")).toBe("#111a2c");
    expect(cssVariable(dark, "status-success-bg")).toBe("#162312");
    expect(cssVariable(dark, "status-danger-bg")).toBe("#2c1618");

    // Code/diff markers share Pierre/Git Review hues (not badge status seeds).
    expect(cssVariable(light, "diff-addition-fg")).toBe("#0dbe4e");
    expect(cssVariable(light, "diff-deletion-fg")).toBe("#ff2e3f");
    expect(cssVariable(light, "diff-modification-fg")).toBe("#009fff");
    expect(cssVariable(dark, "diff-addition-fg")).toBe("#5ecc71");
    expect(cssVariable(dark, "diff-deletion-fg")).toBe("#ff6762");
    expect(cssVariable(dark, "diff-modification-fg")).toBe("#69b1ff");
  });

  // ── Tier 3: design decision — solid status seeds vs white glyphs ────
  // Both themes now use Ant Design status seeds that are chromatic fills /
  // icons, not white-on-solid badge bases. WCAG luminance-only ratios for
  // white glyphs on these seeds are often < 3:1; toast solid glyphs keep a
  // dark capsule surround. Soft alerts put neutral text on soft surfaces.

  it("documents solid status seed tokens exist in both themes", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    for (const block of [
      cssBlock(globals, ":root"),
      cssBlock(globals, ":root.light"),
    ]) {
      expect(cssVariable(block, "status-solid-foreground")).toBeTruthy();
      for (const token of [
        "destructive",
        "warning",
        "success",
        "info",
        "done",
      ]) {
        expect(cssVariable(block, token)).toBeTruthy();
      }
    }
  });

  it("locks shimmer band tokens to a dim trough and theme-primary highlight", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    // Trough is 35% foreground so the band reads; Tier-1 body contrast does
    // not apply to it (see globals.css). Highlight must be --primary 45%
    // into --foreground, with no status-* or per-instance color var.
    const base = cssVariable(globals, "shimmer-base");
    const highlight = cssVariable(globals, "shimmer-highlight");
    expect(base).toMatch(/var\(--foreground\)\s+35%/);
    expect(highlight).toContain("var(--primary) 45%");
    expect(highlight).toMatch(/var\(--foreground\)/);
    expect(highlight).not.toMatch(/--status-/);
    expect(highlight).not.toMatch(/--pier-agent-status-color/);
  });

  it("binds toast surfaces and glyphs to contrast-safe semantic tokens", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const sonner = readFileSync(
      join(ROOT, "src/renderer/components/primitives/sonner.tsx"),
      "utf8"
    );
    const statusIcon = readFileSync(
      join(ROOT, "packages/ui/src/status-icon.tsx"),
      "utf8"
    );
    for (const block of [
      cssBlock(globals, ":root"),
      cssBlock(globals, ":root.light"),
    ]) {
      const surface = neutralOklchLightness(
        cssVariable(block, "toast-surface")
      );
      const foreground = neutralOklchLightness(
        cssVariable(block, "toast-foreground")
      );
      expect(
        contrastRatio(surface ** 3, foreground ** 3)
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(globals).toContain("--toast-action-bg:");
    // Toaster --normal-* 默认为胶囊反色表面；胶囊规则用 :not(.pier-msg-toast)
    // 排除形态 B，所以胶囊的 toast-surface / toast-foreground 不污染卡片。
    expect(sonner).toContain('"--normal-bg": "var(--toast-surface)"');
    expect(sonner).toContain('"--normal-text": "var(--toast-foreground)"');
    expect(globals).toContain(
      "[data-sonner-toast].pier-toast:not(.pier-msg-toast)"
    );
    expect(globals).toContain("background: var(--toast-surface) !important");
    expect(globals).toContain("color: var(--toast-foreground) !important");
    // 形态 B 卡片通过 per-call style 切 --normal-* 到 popover 语义令牌，
    // 继承 sonner 默认 [data-styled=true] 卡片，不在 globals.css 覆盖几何。
    const showNotification = readFileSync(
      join(ROOT, "src/renderer/lib/notifications/show-notification-toast.tsx"),
      "utf8"
    );
    expect(showNotification).toContain('"--normal-bg": "var(--popover)"');
    expect(showNotification).toContain(
      '"--normal-text": "var(--popover-foreground)"'
    );
    expect(showNotification).toContain('"--normal-border": "var(--border)"');
    expect(showNotification).toContain(
      '"--width": "min(360px, calc(100vw - 32px))"'
    );
    // 形态 B 不用 !important 覆盖 sonner 默认卡片几何（padding 微调除外）
    const formBBlock = globals
      .slice(globals.indexOf("/* ── 形态 B"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(formBBlock).not.toContain("!important");
    expect(sonner).toContain('StatusIcon kind="success"');
    expect(sonner).toContain('StatusIcon kind="warning"');
    expect(statusIcon).toContain("text-status-solid-foreground");
    expect(statusIcon).toContain("var(--warning)");
    expect(sonner).not.toContain("text-[color:var(--toast-surface)]");
  });
});
